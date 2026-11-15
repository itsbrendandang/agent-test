# Proposal: four sets of agent definitions, what overlaps, what was merged

For the owner and Josue to decide. Written 2026-11-14 by reading the files, not the names. Nothing here ran; no
paid call was made. Sets (a) and (b) were **not changed**. Sets (c) and (d) were merged where they covered the same job.

Revised after reading the Popper paper (Huang et al., arXiv:2502.09858): two merges first made in this task (medicinal-chemist
with sar-analyst, admet with qsar-property-modeler) were **undone**, because the paper's division of labour treats a reviewer
and an executor as different jobs. Only the prior-work / literature merge stands. Nothing was ever committed, so there is
nothing to revert in git. Section "What Popper suggests" is at the end.

## The four sets

| Set | Where | Count | Runs? | Owner |
|---|---|---|---|---|
| (a) swarm roles | `glhf/bixbench/src/bixbench3/inspect_harness/swarm/roles.py`, `catalog.py` | 9 | Yes (the BixBench solver) | benchmark side, do not touch |
| (b) board roster | `board/agents/*.md`, `board/config.yaml` | 10 (lead + 9) | Yes (the drug board) | Josue |
| (c) specialist profiles | `glhf/specialists/*.md` | 9 (was 9; one of them now carries skills) | No: instructions only, listed in the catalogue | this task |
| (d) skill agents | `glhf/specialists/skills/*.md` + 1 merged file in `glhf/specialists/` | 19 (18 files + 1 merged; was 19 files) | No: instructions only, packages not installed | this task |

### (a) Swarm roles (run in a sandbox with bash, python, editor)

Every role also gets `bash_session`, `python`, `text_editor`, `request_web_access`, `check_outputs`, `read_ledger`; `search_docs` with `--exa`. Extra tools below.

| Role | Job | Extra tools |
|---|---|---|
| scout | Inspect inputs, map samples to conditions, check environment; writes `data_report.md`, `sample_sheet.tsv`. No analysis. | none |
| proposer (`planner`) | Write `plan.md`, register 3 to 8 falsifiable claims. | `propose_claim` |
| pilot | Run the pipeline on a subsample. | none |
| experimenter | Run the full analysis, produce the required files. | none |
| auditor | Check the methods against the study instructions. | `raise_issue` |
| critic | Register falsification tests before running them, record results, try to break claims. | `raise_issue`, `register_falsification_test`, `record_falsification_test`, `report_failed_replication` |
| reviser | Fix what the auditor and critic flagged. | `resolve_issue` |
| finisher | Check every required output exists and opens; recover missing ones from real data. | none |
| reporter | Write the report and the rejection ledger. | none |

### (b) Board roster (text only: `tools: []` on all nine, "cannot run code on this board yet")

`lead-scientist` (coordinates, `converse`, `write_memo`), `scout`, `proposer`, `pilot`, `experimenter`, `methods-auditor`,
`critic` (on a different vendor from the lead), `reviser`, `finisher`, `reporter`. Same nine jobs as (a), written as short
prompts with a deliverable line each. `board/config.yaml` maps them to model tiers (`strong`, `cheap`, `rival`) and sets caps.

### (c) Specialist profiles (all instructions only)

| Name | Job | Tools | Skills |
|---|---|---|---|
| chief | Triage into competing hypotheses; discharge summary | converse, read_ledger, propose_claim | 0 |
| contrarian | One alternative reading of the question | read_ledger, propose_claim | 0 |
| attending-skeptic | Pre-register falsification tests, argue against each hypothesis | register_falsification_test, record_falsification_test, raise_issue, read_ledger | 0 |
| methods-librarian | What the documentation says about a tool or default (manuals only) | search_docs | 0 |
| target-biologist | Does the analysis measure the biology asked: identifiers, organism, contrast, causal vs correlational | search_docs, read_ledger | 0 |
| toxicologist | Risk register for clinical and safety results: outcome definition, censoring, confounders, specification sensitivity | read_ledger, raise_issue | 0 |
| medicinal-chemist | Judge potency, dose-response, selectivity, computed properties | search_docs, read_ledger | 0 |
| admet | Check ADME and assay analyses | search_docs, read_ledger | 0 |
| **literature-evidence-synthesist** (merged) | What others have registered, published or claimed: competing programmes, trial landscapes, meta-analysis, method comparison | read_ledger | 5 |

### (d) Skill agents still separate (18, each owns its skills; no tools field, no frontmatter)

| Agent | Job | Skills |
|---|---|---|
| sar-analyst | Interpret an existing series: Free-Wilson, matched pairs, R-group decomposition, hit-series SAR | 4 |
| qsar-property-modeler | Single-endpoint ADME and affinity models from labelled tables | 4 |
| compound-set-curator | Filter, cluster, featurize, ring-system profile an existing molecule set | 4 |
| small-molecule-designer | Generate, enumerate, dock, assess small molecules and degraders | 7 |
| protein-and-antibody-engineer | Structure prep, structure prediction, antibody developability, binder design | 4 |
| target-prioritiser | Nominate and rank targets, antigens, indications | 6 |
| target-safety-druggability-analyst | Druggability, modality, tissue specificity, FAERS signals for a chosen target or drug | 4 |
| bulk-rnaseq-analyst | Dataset retrieval, FASTQ to counts, DE, modules, deconvolution, enrichment | 7 |
| omics-biomarker-integrator | Bulk clustering, longitudinal omics, proteomics, microbiome, multi-omics | 7 |
| perturbation-and-crispr-specialist | Guide design, Perturb-seq, perturbation prediction, drug-seq | 6 |
| epigenomics-regulator-analyst | ChIP-Atlas targets and enrichment, upstream regulators | 4 |
| single-cell-core-analyst | scRNA-seq processing, trajectories, CELLxGENE Census | 4 |
| single-cell-multimodal-spatial-analyst | scATAC/Multiome, CITE-seq, spatial and GRN (index only) | 6 |
| statistical-geneticist | Mendelian randomization; fine-mapping, TWAS, PRS (name only) | 5 |
| variant-and-genome-analyst | Variant annotation, cohort genomics, calling, long reads | 7 |
| immune-cell-therapy-analyst | CAR design and CRISPR-screen reanalysis, TCR/BCR repertoire | 4 |
| clinical-and-experimental-design-analyst | Trial simulation, plate layout, population PK/PD, RWE cohorts, survival | 6 |
| workflow-and-method-engineer | Nextflow, skill packages, method-development loops | 6 |

Skills in total: 100, each owned once (`python3 glhf/specialists/verify_skills.py` passes).

## Overlap table

Strength: **same job** = one agent's job is inside the other's; **partial** = a real share of the work is the same;
**name only** = the words match, the work does not.

### Between (a) and (b)

| Pair | Strength | What overlaps |
|---|---|---|
| scout, pilot, experimenter, reviser, finisher, reporter (a) vs the same names (b) | **same job** | Same nine-phase job, one prompt each. (a) is long, tool-using and tuned on the benchmark; (b) is a short paraphrase with a deliverable line and no tools. |
| proposer (a) vs proposer (b) | **same job** | Plan and 3 to 8 falsifiable claims. (b) says "named claim, test and threshold". |
| auditor (a) vs methods-auditor (b) | **same job** | Methods against study instructions; only the name differs. |
| critic (a) vs critic (b) | **same job** | Falsification. (a) registers tests with tools; (b) states the intention in text and the checkers decide. |
| (a) has no lead; (b) has `lead-scientist` | not an overlap | In (a) the solver code is the coordinator. |

### Between (a)/(b) and (c)

| Pair | Strength | What overlaps |
|---|---|---|
| critic (a, b) vs attending-skeptic (c) | **same job** | Same four ledger tools, pre-register before running, "attack evidence not people". The profile adds: "send back at most once", "you see scripts and outputs, never the resident's reasoning". |
| lead-scientist (b) vs chief (c) | partial | Frame the question, address members by name, report only accepted findings. (b) also runs rounds and writes the memo; (c) adds acuity and budget share per hypothesis. The catalogue links them through `based_on`. |
| proposer (a, b) vs contrarian (c) | partial | Both turn the question into claims; contrarian adds one alternative reading and runs after triage. |
| reporter (a, b) vs chief discharge summary (c) | partial | Accepted findings as the answer plus the rejection log. |
| auditor (a, b) vs toxicologist (c) | name only to partial | Both list what could make a result wrong; the toxicologist is limited to clinical and safety outcomes. |
| experimenter/pilot (a, b) vs medicinal-chemist, admet (c) | name only | Role (runs the analysis) vs domain (judges molecules); no shared instruction. |

### Between (c) and (d)

| Pair | Strength | What overlaps | Action |
|---|---|---|---|
| medicinal-chemist (c) vs sar-analyst (d) | same domain, **different role** | Potency trends and structure-activity. The profile reviews ("judge results", "name the script so an attending can rerun it"); the skill agent carries the procedures that produce the result. | Left separate for independence (Popper §2.4, §3; see "What Popper suggests"). Was merged, then undone |
| admet (c) vs qsar-property-modeler (d) | same domain, **different role** | In-vitro ADME assays and models: the profile checks analyses, the skill agent builds the models. | Left separate, same reason. Was merged, then undone |
| prior-work-analyst (c) vs literature-evidence-synthesist (d) | **same job (landscape)** | What others have registered or claimed (skill 19 trial landscape, skill 52 citation-verified comparison). Meta-analysis (29) and literature reviews (45, 46) are extra. | **Merged** into `literature-evidence-synthesist` (same role: both gather evidence) |
| methods-librarian (c) vs literature-evidence-synthesist (d, skill 52) | partial | Both answer "which method or default". Librarian reads documentation only; skill 52 compares published methods. | Left separate |
| toxicologist (c) vs clinical-and-experimental-design-analyst (d, skills 75, 91) | partial | The toxicologist's instructions (outcome definition, censoring, population, confounders) are what a survival or cohort analysis needs. | Left separate |
| toxicologist (c) vs target-safety-druggability-analyst (d, skill 62) | partial | "Safety, adverse events" in the trigger; skill 62 detects FAERS signals. | Left separate |
| target-biologist (c) vs statistical-geneticist, single-cell-core-analyst, bulk-rnaseq-analyst (d) | partial | Trigger covers expression, single-cell, GWAS/MR, pathway; each skill agent owns one slice. | Left separate |
| target-biologist (c) vs target-prioritiser (d) | name only | Validity of an analysis vs nominating targets. | Left separate |
| admet (c) vs clinical-and-experimental-design-analyst (d, skill 67) | partial | "Pharmacokinetics, exposure, clearance" vs population PK/PD. Skill 1 says it is not for in-vivo or population PK. | Left separate |
| chief, contrarian, attending-skeptic (c) vs any (d) | none | Process roles; no skill agent does their job. | n/a |
| methods-librarian (c) vs workflow-and-method-engineer (d) | name only | Looking up a method vs building a pipeline. | Left separate |

### Within (d)

| Pair | Strength | What overlaps | Action |
|---|---|---|---|
| sar-analyst vs qsar-property-modeler | partial | Skill 49 hands QSAR to skill 4 (both executors). | Left separate: different methods |
| compound-set-curator vs sar-analyst | partial | Scaffold and ring analysis (78) vs R-group decomposition (73). | Left separate (the original reconciliation chose this, `skills/README.md` note 6) |
| compound-set-curator vs small-molecule-designer vs qsar-property-modeler | name only | All "small molecules"; curate / generate / model. | Left separate |
| single-cell-core-analyst vs single-cell-multimodal-spatial-analyst | partial | Same field, split by modality (RNA vs ATAC, CITE-seq, spatial); 6 of the 10 skills are index only. | Left separate: merging gives a 10-skill agent whose job is two jobs |
| bulk-rnaseq-analyst vs omics-biomarker-integrator vs epigenomics-regulator-analyst | partial | Bulk omics three ways; skill 6 and 98 chain from DE. | Left separate (`skills/README.md` note 2) |
| perturbation-and-crispr-specialist vs immune-cell-therapy-analyst | partial | CRISPR screens (69, 84 vs 11). | Left separate (the 11 text carries a paywall flag; keeping it in one place avoids hiding it) |
| target-prioritiser vs target-safety-druggability-analyst | partial | Both target-level; one nominates, one assesses a chosen target. | Left separate: sequential jobs |
| statistical-geneticist vs variant-and-genome-analyst | name only | Genetics; MR vs variants. | Left separate |

## What was merged (from, into, why)

| From | Into | Why |
|---|---|---|
| `glhf/specialists/prior-work-analyst.md` and `glhf/specialists/skills/literature-evidence-synthesist.md` | `glhf/specialists/literature-evidence-synthesist.md` | Same job: both gather and compile what others have registered, published or claimed. In the paper's division of labour (design agent, execution agent, relevance checker; sections 2.4 and 3) neither is a test designer or the producer of an analysis's p-value, so merging them mixes no roles and costs no independence. Name from the skill agent; the profile's rules apply to the whole agent (a source for every stage claim, never search for the study being reproduced). One instruction was added: state each claim as a measurable implication with a check that could show it false, named before the result is seen (paper sections 1 and 2.2; our README "Proof points" and the ledger's `propose_claim` null already ask for the same). |

How: the profile's frontmatter, purpose and rules were kept as written; the skill agent's routing, skill entries and limits
were appended unchanged. The merged file sits next to the other profiles because the catalogue
(`engine/src/chat/catalog.ts`) lists only that folder, so the catalogue still shows nine specialists and nothing in
`engine/` or `dashboard/` needed editing. Every file still says "instructions only"; the four owner-decision skills (11
paywall technique, 96/97 billed compute, 84 sgRNA commercial review, 94 ADFR non-commercial) are in files that were not touched.

## Left separate on purpose, and why

Pairs that share a domain but not a role stay two agents. The paper separates the agent that designs and checks a test
from the one that executes it and reports the p-value (sections 2.4 and 3), and keeps the designer from seeing the data
the test will use (section 3, Assumption 2 in section 2.4). A reviewer that is also the executor of the same analysis checks
its own work. So each domain has a reviewer profile and executor skill agents:

| Reviewer (profile) | Executor skill agents in the same domain | Overlap strength |
|---|---|---|
| medicinal-chemist | sar-analyst, compound-set-curator, small-molecule-designer | same domain; different role |
| admet | qsar-property-modeler (and, for population PK, clinical-and-experimental-design-analyst) | same domain; different role |
| toxicologist | clinical-and-experimental-design-analyst (survival, cohorts), target-safety-druggability-analyst (FAERS) | partial; its half-and-half fit also argues against merging it into either |
| target-biologist | statistical-geneticist, single-cell-core-analyst, bulk-rnaseq-analyst, omics-biomarker-integrator | partial across four agents |

Also left separate: methods-librarian (documentation only, by the AGENTS.md allow-list) from the literature agent;
single-cell-core from single-cell-multimodal-spatial; the three bulk-omics agents; perturbation-and-crispr from
immune-cell-therapy (the paywall flag stays in one place); target-prioritiser from target-safety-druggability (nominate
versus assess). chief, contrarian and attending-skeptic have no skill counterpart.

If the owner prefers fewer files over this separation, the earlier merges are mechanical (profile frontmatter and rules on
top, skill agent's routing and skills below) and `skills-map.json` needs two renames. The cost is one prompt that both
designs/judges and executes.

## Found while reading (not fixed)

- Every specialist's `based_on` points to a board file that no longer exists except `chief` (lead-scientist). The
  catalogue's `boardMembers()` joins on that name, so a specialist's trigger words only feed the lead's matching now.
  Fix when (b) is decided: point `based_on` at the swarm role it replaces, or drop the field.
- The skill agents (the 18 still in `skills/`) have no frontmatter, so even if the catalogue read them they would show no tools or trigger.
- There was no verification script in the repo; the earlier check lived in `/tmp/recon/verify.py`. It is now
  `glhf/specialists/verify_skills.py` (adds: the merged file, no leftover names, the four owner flags).

## Decision 1: (a) swarm roles vs (b) board roster

They are the same nine jobs twice. Options:

1. **Keep both as they are.** Nothing breaks. The prompts will drift (they already differ in length and in the tools
   they claim). Anyone reading "critic" has to ask which one.
2. **One source, two views.** The board's nine files are derived from the swarm's definitions (or both from one shared
   file), with a short board overlay (deliverable, "cannot run code yet"). Removes the duplicate. Costs: Josue's files
   stop being hand-edited; any change to the swarm prompts changes the board, so benchmark prompts and board prompts can no
   longer be tuned separately. The swarm roles must stay untouched while the benchmark runs, so the direction is
   swarm to board only.
3. **Board runs on the swarm engine.** Drop `board/agents` and run drug briefs as a swarm case. Biggest cut in
   duplication. Costs: the board's conversation, checkers and per-member memory would have to be rebuilt in the swarm,
   and the roster/caps in `board/config.yaml` go away.
4. **Rename only.** Give (b) different names (for example `plan-writer`) so a reader can tell them apart. Cheap, removes
   confusion, keeps the duplicate prompts.

## Decision 2: should the board be process roles or domain experts

Today the board is process roles (a plan, a test, a check). The specialists and skill agents are domain experts, and nothing runs them.

| Option | What the board looks like | Consequence |
|---|---|---|
| Process roles (today) | lead + nine roles | Good at "was the method followed and can it be reproduced", which is the benchmark question. Domain judgement (hERG margins, ADME pooling, survival definitions) has to come from the lead and the model's own knowledge. The 27 domain files stay unused. |
| Domain experts | chief, contrarian, skeptic, medicinal-chemist, admet, toxicologist, target-biologist, literature-evidence-synthesist, methods-librarian | Matches what a drug question needs. Costs: a loader, a mapping of profile tools and tiers to what a run has, trigger rules in code, and the 18 skill agents have no frontmatter. Nobody has measured whether it improves anything. More members means more spend per run against the same `max_usd`. |
| Hybrid (the design `glhf/specialists/README.md` already describes) | A short process spine (lead, proposer, experimenter, critic) with domain experts called by rule, one consult per hypothesis | Keeps reproducibility checks, adds domain checks only when triage tags a domain. Needs the same wiring as the domain option, plus the rules for when a specialist is called. Smallest change in spend. Collapses the critic/attending-skeptic duplicate as a by-product. |

None of these is tested. The skill agents' effect on accuracy is untested whichever option is chosen.

## What Popper suggests

Source: Huang, Jin, Li, Li, Candès, Leskovec, "Automated Hypothesis Validation with Agentic Sequential Falsifications",
arXiv:2502.09858v1 (14 Feb 2025). Section numbers below are the paper's. "Paper" means that text; anything marked
**ours** was read from our files. Sets (a) and (b) are proposals only: nothing in them was changed.

### The paper's method in one paragraph

A hypothesis H has a null H0 (section 2.1). Each round, a **design agent** proposes a measurable implication
(sub-hypothesis) with its own null h0i and alternative h1i, and how to test it; a separate **relevance checker** scores
whether h0i is implied by H0 and discards the test below a threshold; an **execution agent** runs it and returns one
p-value; code turns the p-value into an e-value, e = kappa * p^(kappa-1) (equation 1), multiplies the e-values, E = product
of e_i, and declares the hypothesis validated if E >= 1/alpha, else continues until a test budget is reached
(sections 2.2, 2.4, 3; Algorithm 1 in A.1). A test that fails to run is "simply recorded as a failed attempt, and the
procedure moves on" (section 2.4). Theorem 4: under Assumptions 1 to 3 the Type-I error is at most alpha. The paper's
design agent sees only table schemas, never data or summary statistics (section 3).

### How the paper's method differs from ours (read before adopting anything)

| Point | Paper | Ours (`swarm/ledger.py`, `docs/DESIGN.md` section 3) | Consequence |
|---|---|---|---|
| Combining e-values | Product of e_i (section 2.4, Theorem 4). Valid because the sequence is a supermartingale under Assumptions 1 to 3 (A.2). | Arithmetic mean over every registered test; a registered test with no result counts as 0. Valid under any dependence, by Markov (`ledger.py` docstring). | The mean needs no independence or sequencing assumption but is weaker. Example, alpha 0.1, one claim: two tests with p = 0.0156 give e = 4 each (kappa 0.5). Paper: product 16 >= 10, validated. Ours: mean 4 < 10, not supported. Evidence does not multiply in our rule (DESIGN.md says so). |
| Adaptive follow-up | Test i may depend on the earlier data and p-values: Assumption 2 asks for e-values valid conditional on the past, and the design agent is shown earlier tests and p-values (section 3). | Registration closes at the claim's first result; at most 3 tests are fixed before any result (`register_test`). | Ours is stricter. We cannot design test 2 after seeing test 1. The product rule would allow it, but only if Assumption 2 holds, which our code cannot check. |
| Stopping | Stops when E >= 1/alpha or the budget is spent (Assumption 3, optional stopping). Budget: 3 tests on DiscoveryBench, 5 on TargetVal (section 4.1). | Every registered test is run; no early stop. | No cost saving from early stopping. I did not analyse whether a valid stopping rule exists for the mean. |
| Failed or missing test | Recorded as failed and skipped (section 2.4; Algorithm 1 keeps F_failed apart from the e-values; Table 1 round 3 has no p-value and no e-value). | Counts as e = 0 and blocks "supported". | Opposite policy. Ours cannot be gamed by dropping an unfavourable run. The paper's is more tolerant of broken executions (appendix H). I did not find in the sections I read a discussion of whether skipping failures can bias the result. |
| Implication assumption | Assumption 1: if H0 is true, h0i is true. Enforced approximately by the design agent's self-critique and a separate relevance checker (section 3). Removing the checker raised Type-I error on all three benchmarks (Table 3, POPPER-NoReleCheck). | Not a separate check. The ledger asks for a p-value "under the claim's null" and treats it as valid if the code ran. The relevance of a test to the claim is left to the critic. | Our stated guarantee assumes valid p-values; the implication step is hidden inside that. |
| What the p-value is | Produced by an execution agent running code, then trusted. The paper's largest failure class is misread p-values (35.9 percent of 128 failures) and tests that break the implication (17.2 percent) (section 4.2, appendix D). | Reported by a model through `record_falsification_test`; code cannot re-derive it (`ledger.py` docstring says so, and `FINDINGS.md` repeats it). | Same weakness, stated more plainly by us. |
| Error criterion | One hypothesis at level alpha. Bonferroni (alpha/M) for family-wise error and eBH for false discovery rate are mentioned as possible, "beyond the scope" and not evaluated (appendix C). Appendix C also warns that Type-I control does not make a validated hypothesis true. | Bonferroni across the m registered claims: support needs mean e >= m/alpha. | We already do the paper's simple multi-hypothesis option. eBH is not implemented anywhere here. |
| Output | Binary: validated or not (section 2.1). | Four verdicts, including "refuted" when a contradicting test has p < alpha/m. | "Refuted" has no counterpart in the paper. Ours says it is not error-controlled. Do not describe it as a Popper result. |
| Calibrator | e = kappa p^(kappa-1) (equation 1). The text I read gives no value for kappa. Table 1 is consistent with kappa = 0.5 in rounds 1 and 2 (p 1.0 gives 0.5; p 0.0088 gives cumulative 2.67). Round 4 (p 4.7e-4, cumulative 30.78) is half of what kappa = 0.5 gives; I could not reconcile it. | kappa = 0.5 and a p floor of 1e-6, so one test is worth at most 500 (`KAPPA`, `P_FLOOR`). | Same calibrator family. The floor is ours, not the paper's. |
| What was tested | Hypotheses of the form "gene A regulates phenotype B" against static tables, with negatives made by column-wise permutation (section 4.1). Nine experts matched it on Type-I error and power, with no significant difference at that small sample (section 4.1, appendix F). | Claims about whether an analysis was done right ("replicates cluster by condition", "the knocked-down gene is down"), from BixBench-style tasks. | Applying the paper to our claims is by analogy. Its error guarantee was not shown for our kind of claim. Our own simulation covers the ledger rule (`tests/unit/test_glhf_ledger.py`); no real-model run has used the mean rule. |
| Model strength | Weaker backbone, higher error: Claude Haiku 3.5 had a high Type-I error where Sonnet 3.5, GPT-4o, o1 and Llama 3.3 70B stayed controlled (Table 4, section 4.1). Both agents need strong reasoning and coding. | The board puts scout, pilot and finisher on the `cheap` tier (`board/config.yaml`); the swarm's critic tier is set by `critic_model`. | Do not put the role that writes and runs a test, and produces a p-value, on the cheap tier. Untested for our models. |

### Swarm (set a): proposals only

| Idea (paper section) | What we already do, where | What we do not do | Smallest change that would adopt it |
|---|---|---|---|
| Claim with a null and a measurable implication (1, 2.1, 2.2) | `propose_claim(text, artifact_ids, null_hypothesis)` in `tools.py`; `Claim.null_hypothesis` in `ledger.py`; the proposer is told to write one check that would prove each claim wrong (`roles.PLANNER`). | A test has no null or alternative of its own, only a name and a free-text `method` (`Registration`). | Add optional `null` and `alternative` fields to `register_falsification_test` and store them in `Registration`. Display only; no change to the verdict. |
| Pre-registered tests (2.4, 3: the design agent fixes the test before the data it runs on) | Stronger than the paper: registration before any result, closed at the first result, every registered test counts, favourable results only under a registered name (`register_test`, `record_test`, `roles.CRITIC` step 4). | Cannot see a test run in private before registration (our docstring says so). | None needed for the rule. Keep the limitation in `FINDINGS.md`. |
| Design separated from execution; designer sees schema only (2.4, 3, Assumption 2) | Roles have empty contexts and the critic did not do the analysis (`roles.CRITIC`). | The critic both registers and runs the tests, with full access to files and outputs. | Split the critic's falsification step into two calls: register tests from `data_report.md`, `sample_sheet.tsv` and the claim only; then a second call runs the registered tests. Same `agent()` helper, different instructions. The contract and data checks in the critic's other steps need the files and stay as they are. |
| Relevance check of each test against the claim, by a separate judge (3, Assumption 1, Table 3 ablation) | None. | No step asks whether a registered test's null is implied by the claim's null. | One extra model call before `register_test` returns, scoring 0.1 to 1.0 with the paper's rubric (listing 4, appendix I) and refusing below a threshold. The paper gives no threshold in the sections I read; choose and record one. The paper's own caveat applies: the judge scored 85 percent of tests as strongly implied against 77 percent for humans, Spearman 0.55 (section 4.2, appendix G). A filter, not a proof. |
| Product of e-values with optional stopping (2.4, Theorem 4) | The earlier real-model demo used a product rule; the mean replaced it (`DESIGN.md` section 3). | Product, adaptive follow-up, early stop. | Do not adopt without a way to check Assumption 2. If wanted, keep the mean as the verdict and report the product beside it as information only. |
| Failed experiments recorded and skipped (2.4) | The opposite: a registered test with no result counts as 0. | Skipping. | Keep ours. Add a `failed` status that records why a test could not run, still counted as 0, so the reason is visible. |
| Multiple hypotheses: Bonferroni, eBH (appendix C) | Bonferroni, alpha/m (`ledger.py`). | eBH for false discovery rate. | None now. eBH is untested in the paper too. |
| Error analysis by failure class (4.2, appendix D) | Issue log with severity (`Issue`). | No classification of why a claim failed. | Add an optional `failure_class` to the critic's issues, using the paper's five classes (misread p-value, ineffective design, test breaks implication, wrong implementation, data not found), to see in real runs which is common. |

### Board (set b): proposals only

The board's claims are `[literature|computed|brief] text (source: ...)` lines (`engine/src/board/claims.ts`). A checker returns a
verdict word (`engine/src/board/checkers.ts`); `computed` claims are rechecked by code (RDKit). There is no null, no test and no
p-value. The paper's method applies to `computed` claims backed by a dataset; a `literature` claim has no p-value to
calibrate, so the paper does not cover it.

| Idea (paper section) | What we already do, where | What we do not do | Smallest change that would adopt it |
|---|---|---|---|
| Measurable implication and a test that could show it false (1, 2.2) | `board/agents/critic.md`: "name the test that could show it is false before you look at its result". Words only. | Nothing records the test or checks it was named first. The checkers decide the verdict, not a computed rule. | Add a `falsified-by` part to the CLAIMS line (`claims.ts` parser) and show it in the run's event log. No statistics. |
| Separate designer, executor, relevance judge (2.4, 3) | Critic on another vendor from the lead (`board/config.yaml`, rival tier); checkers separate from members. | Members have `tools: []` and cannot run anything ("cannot run code on this board yet"), so there is no execution agent. | Nothing until a board member can run code. Then use the swarm's split rather than inventing another. |
| Per-claim evidence that accumulates and is combined by code (2.4) | Per-claim verdicts from checkers; first pass by a cheap model, escalation to OpenAI or Claude Code (`checkers.ts`, `board/config.yaml`). | No numeric evidence, no combining rule, no error bound. A verdict is a model's reading. | If board claims ever carry p-values from run code, reuse `swarm/ledger.py` instead of writing a second ledger. |
| Claims decided by code, not a model | Stated for the swarm in AGENTS.md; on the board `computed` claims are recomputed by RDKit. | `literature` and `brief` claims are decided by a model checker. | Say so in the memo for each claim kind (a one-line label), so a reader does not take a model's reading for a computed result. |
| Model strength (Table 4) | Members that reason and write are on the `strong` tier; the critic's first-pass checker is `cheap`. | The first-pass check of a claim is on the cheap tier. | Keep, and measure how often the cheap first pass is overturned on escalation before widening its use. `docs/cost.md` has the recorded rates. |

### Specialists and skill agents (sets c and d): what this task did and what remains

| Idea (paper section) | What we already do, where | What we do not do | Smallest change |
|---|---|---|---|
| Measurable implication and a test that could prove it wrong (1, 2.2) | `README.md` "Proof points": what would show it false, registered before any test is run. `attending-skeptic.md`: register each test before running it. | Only the merged `literature-evidence-synthesist.md` states the rule in its own instructions (added in this task). | Add the same one bullet to `chief`, `medicinal-chemist`, `admet`, `toxicologist`, `target-biologist`, `methods-librarian` if the owner wants it. No new capability. |
| Design agent with domain expertise (2.4) | The profiles carry domain judgement (`medicinal-chemist`, `admet`, `toxicologist`, `target-biologist`). | They are not wired, so nothing calls them as designers. | When wired, call a profile to propose the test from schema-level information, and a skill agent to run it. |
| Execution agent (2.4, 3) | The skill agents carry the procedures and declared inputs and outputs. | No packages installed; nothing runs. | None; this is the wiring work already listed as open. |
| Designer and executor kept apart | Reviewer and executor pairs kept as separate agents (`skills/README.md`, "Reviewer and executor pairs"). | Nothing enforces that the reviewer of an analysis did not run it. | A line in the future caller: refuse to route a review to the agent that ran the analysis. |
| Relevance check (3) | `target-biologist` checks that identifiers, reference and contrast are the ones the question means: a validity check, not the paper's implication check. | No agent asks "is this test's null implied by the claim's null". | Add that question to the `attending-skeptic` or a domain specialist as a review step, performed by an agent that did not design the test. |
| Contrarian / alternative readings | `contrarian.md`. | The paper has no counterpart: it validates a given hypothesis and presents itself as complementary to hypothesis generation (section 5, appendix B). | None. Do not cite the paper for this agent. |

## What I read of the paper

Read in full: abstract; sections 1, 2.1 to 2.4, 3, 4.1, 4.2, 5, 6; appendix A.1 (Algorithm 1) and A.2 (proof of Theorem 4);
appendix B (related work); appendix C (limitations); appendix D (error analysis); appendix E (test categories); appendices
F and G (human study and annotation); the first part of appendix H (qualitative analysis); prompt listings 2, 3 and 4
(coding agent, design agent, relevance checker) and the start of listing 5 (summariser). Table 1, Table 3 and Table 4 as
extracted from the PDF text. Not read: the full trajectory transcripts in appendix H and listing 6. Not done: I did not
re-derive the proof beyond checking its steps, did not check any cited work, and did not look at the authors' code.
Figures 2 to 4 were read only through their captions and surrounding text. The text was taken from the PDF at
https://arxiv.org/pdf/2502.09858 (v1) with `pdftotext`; table layouts in that extraction are messy, which is why Table 1
round 4 is marked as unreconciled.
