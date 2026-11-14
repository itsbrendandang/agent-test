# Reading results

Words such as swarm, claim, ledger and verdict are defined in the
[README](../README.md#words-used-in-these-documents).

## Files of a run

Each local run has a folder `glhf/runs/<run-id>/`. Run folders are not in git.

| File | Written by | Content |
|---|---|---|
| `record.json` | Run tracker | The run as the CLI and the dashboard show it: phase, score, settings. |
| `run.json` | `glhf_local.py` | Settings, status, score, score per artifact, token use per model, versions, seed. |
| `grade.json` | The benchmark's grader | The full grade. |
| `runner.log`, `tracker.log` | Runner, run tracker | Logs. Read `runner.log` first when a run fails. |
| `logs/` | Inspect | Every model call of the run. |
| `outputs/` | The agents | The artifacts that were graded. |
| `outputs/METHODS.md` | Reporter, or the single agent | What was run, what failed, what differs from the guidance. |
| `outputs/glhf/FINDINGS.md` | Code (`ledger.py`) | Swarm only. See below. |
| `outputs/glhf/ledger.json` | Code (`ledger.py`) | Swarm only. Every claim, registered test, result, e-value, issue and event. |
| `outputs/glhf/lessons.md` | Code (`memory.py`) | Only with `--memory`. The lessons of this run that passed the filter. They are also queued for approval. |
| `outputs/glhf/scripts/`, `plan.md`, `notebook.md` and others | The roles | Swarm only. Working files copied from the sandbox. |

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
| Rejected analyses | Issues that a reviewer raised and the Reviser fixed. A fix is marked when the Critic did not check it again. |
| Unresolved issues | Issues that are still open or were not fixed. |

## Verdict rules

Code computes every verdict (`swarm/ledger.py`). No model decides a verdict.

The Critic works in two steps, each with its own tool:

1. **Register.** Before it runs any test of a claim, the Critic registers each test with the
   tool `register_falsification_test`: a name, what it will run, and which outcome would
   contradict the claim.
2. **Record.** The Critic runs the tests and reports each p-value (under the claim's null
   hypothesis) with the tool `record_falsification_test`, under the registered name.

Code does the rest.

Let `m` be the number of registered claims in the run, and `alpha = 0.1`.

### Registration

| Rule | Detail |
|---|---|
| Tests per claim | At most 3 registered tests (`MAX_TESTS`). |
| When registration closes | At the claim's first result. After that, no test can be added. |
| A result that favours the claim | Accepted only under a registered name. Without registration it is refused. |
| A result that contradicts the claim | Always accepted: registered or not, over the limit of 3 or not, also a repeat. `FINDINGS.md` marks it "not pre-registered" when it was not registered. |
| One result per test name | A second favourable result with the same name is refused. The first result stands. Names are compared without case, spaces and punctuation. |
| A registered test with no result | Counts as `e = 0`. The claim cannot be supported while one is missing. |

### From p-value to verdict

| Step | Rule |
|---|---|
| p-value floor | A p-value below `1e-6` counts as `1e-6`. |
| e-value of a test | `e = 0.5 / sqrt(p)`. With the floor, one test gives at most `e = 500`. |
| A test that contradicts the claim | Counts as `e = 0.5`. |
| Combined e-value | The **arithmetic mean** of the e-values: all recorded results, plus `0` for each registered test with no result. It is not the product. |
| **Refuted** | A contradicting test has `p < alpha / m`, or the Critic reports a failed replication. Checked first. |
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

The guarantee needs two assumptions:

| Assumption | Why code cannot check it |
|---|---|
| Each reported p-value is a valid p-value from code that was run. | A model reports the number. Code cannot compute it again. |
| No test was run in private before it was registered. | Code sees only the tool calls, not what the model tried before. |

What is **not** controlled:

- A wrong or dishonest p-value.
- Tests that were tried in private and registered afterwards.
- The refuted verdict. One mistaken contradicting test can refute a true claim. There is no
  error bound for refutation.
- Insufficient and untested claims: these verdicts say only that support was not reached.

`FINDINGS.md` states the guarantee, the assumptions and these limits in every run. The method
follows Popper (Huang et al., ICML 2025), as cited in `swarm/ledger.py`.

Tested with automated tests, including a simulation of the error rate
(`glhf/bixbench/tests/unit/test_glhf_ledger.py`). The real-model swarm run on the demo case
(see [status.md](status.md)) used the older rules (product, no registration). No real-model
run has used registration and the mean yet.

## Scoreboard

```bash
npm run scoreboard
```

Rules (`engine/src/glhf/scoreboard.ts`):

- Two runs are compared only when all of these are the same: task, case folder, model, mode
  (local or cloud), effort, time limit and token budget (`pairKey`).
- Each row shows the latest finished run of each solver, also when that run failed.
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
seed and versions (`run.json`).

Report the mean and the range of several runs, not one run.

## Answer leakage

The benchmark's reference tables are in a public storage bucket. The roles are told to use only
the task's inputs, and the benchmark's network policy lists that bucket as protected. We have
not tested the network gate ourselves. The local sandbox has no network at all.
