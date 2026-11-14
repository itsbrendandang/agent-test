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
| `outputs/glhf/ledger.json` | Code (`ledger.py`) | Swarm only. Every claim, test, e-value, issue and event. |
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

The Critic runs tests on a claim. Each test gives a p-value under the claim's null hypothesis.
The Critic reports the p-value with a tool, and code does the rest.

Let `m` be the number of registered claims in the run, and `alpha = 0.1`.

| Step | Rule |
|---|---|
| p-value floor | A p-value below `1e-6` counts as `1e-6`. |
| e-value of a test | `e = 0.5 / sqrt(p)`. With the floor, one test gives at most `e = 500`. |
| A test that contradicts the claim | Counts as `e = 0.5`. |
| Tests per claim | At most 3. One result per test name; a second result with the same name is refused. |
| Combined e-value | The product of the e-values of the claim's tests. |
| **Supported** | The combined e-value is at least `m / alpha`. Example: 4 claims need 40. |
| **Refuted** | A contradicting test has `p < alpha / m`, or the Critic reports a failed replication. |
| **Insufficient** | The claim has tests but is not supported and not refuted. |
| **Untested** | The claim has no tests. |

Refuted is checked first.

Limits of these rules:

- A model reports the p-values. Code cannot compute them again.
- The error bound assumes that the tests on one claim are independent (different data or a
  different method). Code cannot check this. `FINDINGS.md` states this in every run.
- The method follows Popper (Huang et al., ICML 2025), as cited in `swarm/ledger.py`.

## Scoreboard

```bash
npm run scoreboard
```

Rules (`engine/src/glhf/scoreboard.ts`):

- Two runs are compared only when they have the same task, model, time limit and token budget.
- Each row shows the latest finished run of each solver, also when that run failed.
- A difference (swarm minus single agent) is shown only when both runs finished and were graded.
- Extras of each run are listed, for example Exa search, memory, role models, review rounds.
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
| Ledger tools | `read_ledger`, `propose_claim`, `record_falsification_test`, `report_failed_replication`, `raise_issue`, `resolve_issue`. |
| Nine sets of instructions, each role with an empty context | |
| A Reporter phase that always runs | |
| `search_docs` | Only with `--exa`. |
| Lessons from earlier runs on other tasks | Only with `--memory`. |

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
