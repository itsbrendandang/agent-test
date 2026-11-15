# Reading results

Words such as swarm, claim, ledger and verdict are defined in the
[README](developers.md#words-used-in-these-documents).

## Files of a run

Each local run has a folder `glhf/runs/<run-id>/`. Run folders are not in git.

| File | Written by | Content |
|---|---|---|
| `record.json` | Run tracker | The run as the CLI and the dashboard show it: phase, score, settings. |
| `run.json` | `glhf_local.py` | Settings, status, score, score per artifact, token use per model, versions, seed. Token use has input, output and total, plus cache reads and writes, reasoning tokens and cost (`total_cost`) when Inspect reports them. `versions` has the git commit (`git_commit`) and whether tracked files had changes (`git_dirty`). |
| `grade.json` | The benchmark's grader | The full grade. |
| `runner.log`, `tracker.log` | Runner, run tracker | Logs. Read `runner.log` first when a run fails. |
| `logs/` | Inspect | Every model call of the run. |
| `outputs/` | The agents | The artifacts that were graded. |
| `outputs/METHODS.md` | Reporter, or the single agent | What was run, what failed, what differs from the guidance. |
| `outputs/glhf/FINDINGS.md` | Code (`ledger.py`) | Swarm only. See below. |
| `outputs/glhf/ledger.json` | Code (`ledger.py`) | Swarm only. Every claim, registered test (script, hash, relevance judgement, the harness's run), result, e-value, issue and event. The roles' working copy; the copy that counts is `ledger.json` next to `run.json`. |
| `outputs/glhf/lessons.md` | Code (`memory.py`) | Only with `--memory`. The lessons of this run that passed the filter. They are also queued for approval. |
| `outputs/glhf/scripts/`, `plan.md`, `notebook.md` and others | The roles | Swarm only. Working files copied from the sandbox. |

Fields of a run record that tell you how to read the run (`GlhfRun` in
`engine/src/glhf/types.ts`):

| Field | Meaning |
|---|---|
| `phase` | `done`, `failed` and `cancelled` are final. See the list of phases in [running.md](running.md#phases-of-a-run). |
| `pairedWith` | The other run of a matched pair. |
| `after` | The run that this run waited for. |
| `note` | Something to keep in mind, for example `started although <id> ... failed: ...` or `cancelled because <id> ... was cancelled`. `show` does not print it; read it in `record.json` or in the API answer. |

A cancelled run is not a result. It has no score, and the scoreboard leaves it out. Do not
count it as a failed run when you report results; say that it was cancelled.

Quick view in the terminal:

```bash
npm run glhf -- show <run-id>
```

## Score

The score comes from the benchmark's grader, which compares each artifact with a reference
table. We do not change the grader. A score on the demo case shows that the code works. It is
not a benchmark score.

## `FINDINGS.md`

| Section | Content |
|---|---|
| Supported findings | Claims with the verdict supported. |
| Rejected claims | Claims with the verdict refuted. |
| Not established | Claims with the verdict insufficient or untested. They are not findings. |
| Rejected analyses | Issues that a reviewer raised and the Reviser fixed. A fix is marked when the Critic did not check it again. An issue raised by `harness` comes from a refuted claim: code raises it so that the Reviser checks the claim's artifacts. |
| Unresolved issues | Issues that are still open or were not fixed. |

## Verdict rules

Code computes every verdict (`swarm/ledger.py`). No model decides a verdict.

A test goes through four steps. A model does the first two. Code does the last two.

1. **Register.** The Critic writes the test as a script file and registers it with the tool
   `register_falsification_test`: a name, what the script does, which outcome would contradict
   the claim, the test's own null hypothesis, and the script's path. Code reads the file and
   records its content and its SHA-256 hash.
2. **Judge relevance.** After the Critic's turn, one separate model call (the relevance judge,
   `swarm/relevance.py`) rates each registered test: if the claim's null hypothesis were true,
   would the test's null be true too? It sees the claim and the registration. It has no tools
   and never sees a result or another role's reasoning. The score is on a rubric from 0.1 to
   1.0. A test counts from 0.8.
3. **Run.** Code (the harness) runs the registered script in the sandbox. The file must still
   have the registered hash. The result is the last line of the output, which must be exactly
   `GLHF_RESULT p_value=<number in [0, 1]> contradicts=<true|false>`.
4. **Verdict.** Code computes it.

The Critic does not run the registered tests and does not report their p-values. A p-value
typed in by a role is refused, unless it contradicts the claim.

Let `m` be the number of registered claims in the run, and `alpha = 0.1`.

### Registration, relevance and the run

| Rule | Detail |
|---|---|
| Tests per claim | At most 3 registered tests (`MAX_TESTS`). |
| What a test is | A script file under `/workspace/` ending in `.py`, `.sh` or `.R`, at most 64 KB. Its content is kept in the ledger. |
| When registration closes | At the claim's first result or first run, also a run that failed. After that, no test can be added. |
| Relevance | Judged once, after registration and before the run. A test scored under 0.8, or not scored, is still run and recorded but counts as `e = 0`: it cannot support and cannot refute. `FINDINGS.md` marks it "NOT RELEVANT". |
| A test nobody judged | Is not run. It counts as `e = 0`. The ledger has a `relevance.skipped` or `relevance.failed` event with the reason. |
| A result that favours the claim | Accepted only from the harness's run of a registered script. A typed-in one is refused. |
| A result that contradicts the claim | From the harness, like any result. A role may also type one in with `record_falsification_test`: always accepted, registered or not, over the limit of 3 or not. `FINDINGS.md` marks it "typed in by a role, not pre-registered". |
| One run per test | The first run stands. |
| A run with no result | The script changed after registration, is missing, ended with an error, ran too long (5 minutes at most), or printed no result line. Counts as `e = 0`, and the claim cannot be supported. The ledger keeps the status, the command, the exit code, the runtime and the end of the output. |
| A registered test that was never run | Counts as `e = 0`. The claim cannot be supported while one is missing. |

### From p-value to verdict

| Step | Rule |
|---|---|
| p-value floor | A p-value below `1e-6` counts as `1e-6`. |
| e-value of a test | `e = 0.5 / sqrt(p)`. With the floor, one test gives at most `e = 500`. |
| A test that contradicts the claim | Counts as `e = 0.5`. |
| A test judged not relevant, or with no result | Counts as `e = 0`. |
| Combined e-value | The **arithmetic mean** of the e-values: all recorded results, plus `0` for each registered test with no result. It is not the product. This rule did not change. |
| **Refuted** | A relevant contradicting test, or one typed in by a role, has `p < alpha / m`, or the Critic reports a failed replication. Checked first. |
| **Untested** | The claim has no result. |
| **Supported** | Every registered test has a result, and the mean e-value is at least `m / alpha`. Example: 4 claims need a mean of 40. |
| **Insufficient** | The claim has a result but is not refuted and not supported. It is not a finding. |

Example with 4 claims (threshold 40): three tests with `p = 0.0001` each give `e = 50`, mean 50,
supported. Two tests with `p = 0.0001` and one registered test with no result: not supported.

### What the rules guarantee

If a claim's null hypothesis is true, the claim is marked supported with probability at most
`alpha / m`. Over all claims of a run this is at most `alpha = 0.1` (Bonferroni correction).

This holds **under any dependence** between a claim's registered tests. The tests do not need
to be independent. The reason: the mean of e-values is an e-value for any dependence; a product
is one only for independent tests, and code cannot check independence.

The guarantee needs these assumptions:

| Assumption | What code checks, and what it cannot |
|---|---|
| Each counted p-value is a valid p-value. | Code checks that the number came from running the registered script, unchanged since registration, and that nobody typed it. Code cannot check that the script is a meaningful test. A script can print a constant or compute an invalid p-value. |
| The test's null follows from the claim's null. | The relevance judge rates this before the run. It is a model's reading, not a proof. It can be wrong, and the Critic's own description of the test reaches it. |
| The test was not chosen or tuned on the data it tests. | Code checks that the script did not change after registration and that no test was added after a result. Code cannot see what the model ran, or looked at, before it registered the script. |

What is **not** controlled:

- A script that is not a real test.
- A wrong relevance judgement. The ledger records when the judge and the Proposer are on the
  same vendor (`same_vendor_as_proposer`), because they may then share blind spots.
- Scripts tried in private and registered afterwards. In the simulation, a model that tries
  100 scripts and registers the best one gets a true-null claim supported in 22% of runs
  with one claim. This did not change.
- The refuted verdict. One mistaken contradicting test can refute a true claim. There is no
  error bound for refutation.
- Insufficient and untested claims: these verdicts say only that support was not reached.

`FINDINGS.md` states the guarantee, the assumptions and these limits in every run. The method
follows Popper (Huang et al., arXiv:2502.09858), as cited in `swarm/ledger.py` and
`swarm/relevance.py`. Two differences from the paper: we use the mean of e-values, not the
product, and a failed test counts as zero instead of being skipped.

### Reading a test in `ledger.json`

Read `<run folder>/ledger.json` (written by the solver process), not the copy under
`outputs/glhf/`.

| Field | Meaning |
|---|---|
| `claims[].registered[]` | One entry per registered test: `name`, `method`, `by`, `test_null`, `script_path`, `script_sha256`, `script_bytes`, `script` (the registered content), `relevance`, `run`. |
| `registered[].relevance` | `null` until judged. Then `score` (or `null` when the judge gave no usable answer), `relevant`, `reason`, `threshold`, `judge`, `judge_model`, `proposer_model`, `same_vendor_as_proposer`. |
| `registered[].run` | `null` until run. Then `status` (`ok`, `changed`, `missing`, `failed`, `timeout`, `unparsable`), `command`, `exit_code`, `seconds`, `output_tail`, `sha256_at_run`, `p_value`, `contradicts`, `detail`, and where it ran: `backend` (`docker`, or `modal` with `ANALYSIS_BACKEND=modal`) and `sandbox_id`. Only `ok` has a result. Where it ran does not change the verdict rules. |
| `claims[].tests[]` | The results that enter the mean: `name`, `p_value`, `contradicts`, `note`, `by`, `registered`, `e_value`, and now `source` (`harness` or `model`) and `counts` (`false`: judged not relevant, worth 0). |
| Events | `test.registered` (now with `test_null`, `script_path`, `script_sha256`, `script_bytes`), `test.relevance`, `test.executed` (now with `backend` and `sandbox_id`), `test.recorded` (now with `source`, `counts`), `test.not_run`, `relevance.skipped`, `relevance.failed`, and the phase events of `relevance N`. |

Tested with automated tests, including a simulation of the false-support rate with a table of
before and after ([DESIGN.md](../glhf/docs/DESIGN.md#simulation-of-false-support)), and with
the scripted demo. No real-model run has used these rules yet. The real-model swarm run on the
demo case (see [status.md](status.md)) used the older rules (product, no registration).

## Scoreboard

```bash
npm run scoreboard
```

Rules (`engine/src/glhf/scoreboard.ts`):

- Two runs are compared only when all of these are the same: task, case folder, model, mode
  (local or cloud), effort, time limit and token budget (`pairKey`).
- Each row shows the latest finished run of each solver, also when that run failed. Cancelled
  runs and runs that are still queued or going are left out.
- A matched pair (one request with both solvers) always has the same pairing settings, so its
  two runs land in one row. If the first run of a pair failed, the second still ran; the row
  then says that the latest run of that solver failed.
- A difference (swarm minus single agent) is shown only when both runs finished and were graded.
- Extras of each run are listed, for example Exa search, memory, role models, review rounds,
  seed. Extras do not stop the pairing. When they differ, the row has a note that names them.
- The scoreboard prints the number 0.523 as the BixBench3 record to beat (`RECORD` in
  `engine/src/glhf/types.ts`). It applies to BixBench3 tasks only, not to the demo case.

## Is the comparison fair?

Same for both solvers:

- the model (unless `--role-model` is used), the sandbox, the time limit and the grader;
- four tools: `bash_session`, `python`, `text_editor`, `request_web_access`;
- with `--max-tokens`: 10% of the token budget is kept to write `METHODS.md`.

Without `--max-tokens`, the single agent is the benchmark's own solver, unchanged
(`inspect_harness/solvers.py`). With `--max-tokens`, it is the same agent run by our wrapper
`swarm/baseline.py`, which adds the 10% rule.

Only the swarm has:

| Extra | Note |
|---|---|
| `check_outputs` | A format check built from the task's required outputs. |
| Ledger tools | `read_ledger`, `propose_claim`, `register_falsification_test`, `record_falsification_test`, `report_failed_replication`, `raise_issue`, `resolve_issue`. |
| Nine sets of instructions, each role with an empty context | |
| A Reporter phase that always runs | |
| `search_docs` | Only with `--exa`. |
| Approved lessons from earlier runs on other tasks | Only with `--memory`. A person approved each lesson. |

The task has a limit of 5,000 messages (`MESSAGE_LIMIT` in `inspect_harness/tasks.py`). For the
swarm, `--max-messages-per-role` sets a lower limit for each phase. We did not check in a run
how the 5,000 limit counts messages across the swarm's phases.

So the comparison is "one agent" against "a team with extra tools", on the same budget. It is
not a comparison with equal tools. The run settings record the extras
(`swarm_only_tools` in `run.json`).

When you report results:

- Give the number of tasks and the budget, for example "3 tasks, same model and time limit".
  Do not call it a benchmark score unless all 20 tasks ran.
- Name the extras the swarm had.
- Report the token use of both solvers.
- Report failed runs too.

## Repeating a run

A second run with a real model does not give exactly the same result. Model output changes, and
time limits end phases at different points.

Fixed or recorded: the order of roles and their budgets (code), the verdicts (code), every model
call (`logs/`), every search query and claim (ledger), the analysis scripts, and the settings,
seed, versions and git commit (`run.json`).

Report the mean and the range of several runs, not one run.

## Answer leakage

The benchmark's reference tables are in a public storage bucket. The roles are told to use only
the task's inputs, and the benchmark's network policy lists that bucket as protected. We have
not tested the network gate ourselves. The local sandbox has no network at all.
