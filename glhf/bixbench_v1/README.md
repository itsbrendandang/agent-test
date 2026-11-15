# bixbench_v1: single agent vs GLHF swarm on BixBench v1.5

An adapter that runs two solvers on the public
[futurehouse/BixBench](https://huggingface.co/datasets/futurehouse/BixBench) dataset (v1.5: 205
questions on 59 data capsules) in a local Docker sandbox and grades them on the host:

- `single`: one agent, one context, the whole budget.
- `glhf`: a three-role question-answering swarm (analyst, blind critic, reconciler) with an
  answer ledger whose statuses are computed by code.

Same model, image, tools, working rules and time limit for both. Token budget: the same total
by default (`swarm_budget=equal`), or a larger, labelled one (`extended`); see Budgets. No
result is claimed in this file; a run writes its own `report.md`.

This is not BixBench3 (the artifact-reproduction benchmark in `../bixbench`). It reuses that
package's environment and three helpers from its swarm (`Clock`, `PhaseResult`,
`background_processes`); nothing in `../bixbench` was changed.

## Commands

Needs [uv](https://docs.astral.sh/uv/) and Docker. Run from `glhf/bixbench_v1/`.

```bash
uv sync                                   # own virtualenv; depends on ../bixbench by path
uv run bixbench-v1 download               # BixBench.jsonl + 64 zips, 5.9 GB -> glhf/data/bixbench_v1/hub
docker pull futurehouse/bixbench:aviary-notebook-env    # the official environment
uv run bixbench-v1 list                   # capsules, question counts, eval modes, zip sizes
uv run bixbench-v1 audit                  # what staging keeps and drops for every capsule

# One capsule, both solvers, real model (keys come from the repo's .env, never printed).
# Refused unless NO_PAID_CALLS=0; see "Paid calls" below.
uv run bixbench-v1 run --capsules bix-46 --solvers single,glhf \
    --model anthropic/claude-sonnet-5-5 --max-tokens 320000 --time-limit 1800 \
    --out runs/bix-46

# The whole set. Resumable: finished runs are skipped. --total-token-cap stops before a run
# that could exceed it.
uv run bixbench-v1 run --all --solvers single,glhf --model anthropic/claude-sonnet-5-5 \
    --tokens-base 160000 --tokens-per-question 80000 --time-limit 1800 \
    --total-token-cap 60000000 --out runs/full

uv run bixbench-v1 grade  --out runs/full --grading per-mode,official,paper   # grade again
uv run bixbench-v1 report --out runs/full                                     # report.md, report.json

# No keys: a scripted model plays both solvers (plumbing only, not a result).
uv run bixbench-v1 run --capsules bix-46 --model mock --image python:3.12-slim --out runs/mock

uv run pytest -q && uv run ruff check src tests && uv run mypy
```

Other options of `run`: `--unit question` (one run per question, as the official repository's
code does), `--answer-mode mcq|mcq-refusal`, `--role-model critic=openai/gpt-5.5`,
`--swarm-budget equal|extended` (default: `$BIXBENCH_V1_SWARM_BUDGET`, else `equal`),
`--repeats N` (N runs of each unit per solver; repeat k uses seed + k and the folder
`<solver>-rk`), `--sandbox modal` (the analysis runs in a Modal Sandbox and not in local Docker;
billed, another image, not comparable: see "The sandbox on Modal"), `--judge-model`, `--judge-temperature` (a number, or `default` for the
provider's default), `--no-judge`, `--seed`, `--image`, `--force`. `--critic-hints` is still
accepted and is ignored: the critic is never shown anything of the analyst's. `report` takes
`--model` when a folder holds runs of several models; they are never pooled.

Runs go to `runs/<name>/<capsule>/<solver>/`: `outputs/answers.json`, `outputs/METHODS.md`,
`outputs/glhf/{ledger.json, FINDINGS.md, work/}`, `logs/*.eval` (every model call), `run.json`
(all settings, image id, token usage, phases), `grade.json` (verdicts and, per profile, the
judge model and temperature used) and `shuffle_salt.json` (host only; see the integrity
table). While a run is going its outputs are in a neutral folder under
`glhf/data/bixbench_v1/mounts/`; they are moved into the run folder when it ends. A swarm run also writes
`outputs/glhf/questions.json` (per question: analyst answer, critic answer, agreed, same
method, reconciler answer, whether the reconciler changed it) and `outputs/glhf/evidence.json`
(the commands behind each answer); `run.json` repeats the first as `questions` and adds
`budget` (single-agent budget, the solver's total, tokens used, tokens per phase, forced
answers, and whether the run reads as "same budget" or "more budget"). `runs/` and `glhf/data/` are
gitignored. Never commit benchmark data.

## Paid calls (`NO_PAID_CALLS`)

Paid calls are off unless `NO_PAID_CALLS` is exactly `0`. This package uses the switch of
`bixbench3` (`../bixbench/src/bixbench3/paid.py`) through `src/bixbench_v1/paid.py`. Tests:
`tests/test_paid.py` (11 tests, with fakes).

| While the switch is on | What happens |
|---|---|
| `bixbench-v1 run` with a real model or a real `--role-model` | Refused before anything starts. |
| The LLM judge, in `run` or in `grade` | Refused, whichever profile's default it is (`openai/gpt-4o` for per-mode and official, `anthropic/claude-3-5-sonnet-20241022` for paper) or a named one. Use `--no-judge`: the code rules grade what they can and the rest stays ungraded. |
| A model on our own endpoint (`openai-api/<service>/<model>`), and any use of Modal | Refused: it is billed by the second. See the next section. |
| `--sandbox modal` (also with `--model mock`), `modal-sandboxes`, building the Modal image | Refused before anything starts: a Modal sandbox is billed by the second. |
| `--model mock` | Runs. With the default judge setting it uses no judge. If you name a judge model, that is refused. |
| `download`, `list`, `audit`, `report` | Work. They call no model. |
| Provider keys | Set to empty in the process before `.env` is loaded, so `.env` cannot put them back. |

The value is read from the process environment first (an exported value wins), then from the
nearest `.env` above the working folder, then from the repository's `.env`. Only the person
who pays sets `NO_PAID_CALLS=0`.

Not covered: code that calls `run_capsule` or `InspectJudge` directly and not through this
command line. Only seven named provider keys are blanked (see
[docs/running.md](../../docs/running.md#what-is-not-covered)); Google, AWS and Azure
credentials and a saved Hugging Face login pass through.

The real-model commands under "Commands" above need `NO_PAID_CALLS=0`.

## Open models on our own endpoint (`glhf/openmodels`)

A model served behind an OpenAI-compatible endpoint runs like any other model. Nothing in the
solvers changed.

```bash
# The endpoint's address and key come from the environment; the service name is `openmodels`.
OPENMODELS_BASE_URL=https://.../v1 OPENMODELS_API_KEY=... \
uv run bixbench-v1 run --capsules bix-46 --solvers single,glhf --no-judge \
    --model openai-api/openmodels/Qwen/Qwen3.6-35B-A3B-FP8 --out runs/try-qwen
```

- The id is Inspect's `openai-api/<service>/<model>`. Inspect reads `<SERVICE>_BASE_URL` and
  `<SERVICE>_API_KEY`. Token counts are recorded in `run.json` as for other models
  (`tests/test_endpoint_model.py`, with a scripted server).
- Such a model is a paid model for the switch: refused unless `NO_PAID_CALLS=0`. So is every
  use of Modal (`paid.refuse_modal`).
- When every model of the run is on our endpoint and `--no-judge` is given, all vendor keys
  are blanked (`paid.isolate_endpoint`). The run can then reach the endpoint and nothing else.
  With a judge, or with one vendor model among the roles, the keys stay.
- Do not start the server by hand. `glhf/openmodels` serves the models on Modal GPUs, checks
  the key and tool calls, runs this command for a list of models, stops the server, and keeps
  a cost ledger with a cap. It also holds the fixed 20-capsule list and the plan for the
  three-model comparison (Qwen, Claude Opus, OpenAI Sol). See
  [../openmodels/README.md](../openmodels/README.md).
- The same path serves a hosted OpenAI-compatible service, for example Tinker
  (`openai-api/tinker/<model>`, `TINKER_BASE_URL`, `TINKER_API_KEY`). The service's own key is
  kept when the other keys are blanked. Hosted services were never called; tests use a
  scripted server.
- State: Qwen3.6-35B-A3B was served on one Modal L40S and ran one small capsule (bix-46) with
  both solvers as a smoke test, then the 20-capsule grid (code rules only; see the openmodels README).

## Integrity boundary

What the solver can see is fixed by code, and each rule has a test.

| Rule | Where | Test |
|---|---|---|
| Only `question_id`, the question text and (multiple choice only) the shuffled options cross into the task. `PublicQuestion` forbids any other field, so a dataset row cannot be passed through. | `dataset.py` | `test_boundary.py` |
| Multiple-choice options are shuffled with a salt made for each run and kept only in the run folder on the host (`shuffle_salt.json`, owner-readable): not in a prompt, the task, the sandbox, the environment, `run.json` or the eval log. Seed, question id and option count do not give the correct letter (they did: the ideal enters the shuffle first, and 205 of 205 letters could be computed). Grading reads the salt to rebuild the key; without it a multiple-choice run cannot be keyed. | `dataset.public_view`, `runner.write_salt` | `test_boundary.py`, `test_e2e.py` |
| The answer key is never given to Inspect: the task has no target and no scorer, so the key is in no prompt, sample, metadata or eval log. | `task.py`, `runner.py` | `test_boundary.py`, `test_e2e.py` (searches the log file for sentinel strings) |
| The prompt is checked for the capsule's hypothesis, result, paper link, canary and long ideal answers before a run starts. | `runner.check_prompt` | `test_boundary.py` |
| Staging is an allow-list of folder and file type. Folder: only the one named exactly `CapsuleData-<uuid>` with the capsule's uuid from the dataset, at the top of the zip or directly under `CapsuleFolder-<uuid>/` (not any folder with "Data" in its name). Type: only the data types the v1.5 capsules hold (`staging.DATA_SUFFIXES`: xlsx, xls, csv, tsv, txt, rds, h5ad, gmt, faa, fna, fastq, bam, vcf, bwa/samtools indexes, mafft, clipkit, treefile), optionally gzipped, and zip / tar.gz archives. Every dotted part of a name is checked (`solution.ipynb.gz`, `analysis.ipynb.txt`), and the first bytes must fit the name (no zip, gzip or notebook JSON under a data suffix). Archives are opened to any depth: every member must be one of those types or a BUSCO / HMMER / IQ-TREE output type (`ARCHIVE_ONLY_SUFFIXES`); one script, report, notebook or unlisted type withholds the whole archive, as does an unreadable one. A type that is not listed is withheld with the reason "file type not on the allow-list" and `audit` prints it as a problem to review. | `staging.py` | `test_staging.py` (includes the red-team's hostile capsule) |
| The staged folder is verified before every run (exactly the manifest's files, every one an allowed type; a staging made under older rules is redone) and scanned for the secret strings, ignoring case and line wrapping, inside xlsx/zip/gzip files up to 5 MB and through .txt/.csv/.tsv of any size. A mismatch stops the run before any container starts. | `staging.verify_staged`, `leak_scan` | `test_staging.py`, `test_e2e.py` |
| The sandbox has no network and mounts two things: the staged data read-only at `/data`, and `/outputs`. The zip, the question file and the notebooks stay on the host. No API key is in the container. Each run gets its own compose file with its two paths written in; nothing is passed through environment variables, so parallel runs cannot mount each other's capsule. | `task.compose_config` | `test_boundary.py` (parses the file), `test_e2e.py` (a probe inside the container) |
| The two host paths are neutral: `glhf/data/bixbench_v1/mounts/<random>/{data,outputs}` (hard links to the staged files). `/proc/self/mountinfo` in the container therefore shows no capsule uuid, run folder, model or solver name. It still shows the host user's path to the repository. | `runner.neutral_mount` | `test_boundary.py`, `test_e2e.py` (reads mountinfo in the container) |
| Grading runs on the host after Inspect has returned and the container is gone. It refuses an unfinished run. The judge gets the question, the ideal and the answer string only. `grade.json` and `report.json` hold verdicts, not ideals. | `runner.grade_run`, `grading.py` | `test_e2e.py`, `test_grading.py` |

On the v1.5 files the allow-list stages the same 1,084 data files from 64 zips (13.5 GB
unpacked) that the earlier deny-list did and drops the same 49 notebooks (43 in notebook
folders, 6 executed notebooks inside data folders of zips the question file does not use):
no real capsule file is newly withheld. Checked by planning every zip under both rule sets
and comparing member names.

Known limits. Data folders hold intermediate results the benchmark authors provide as inputs
(for example DESeq2 result objects); they are staged, as in the official harness. The type
rule cannot tell a table of inputs from a write-up saved as .txt or .csv; the leak scan is the
only backstop for those, it knows only the capsule's own secret strings, and it does not look
inside rds, bam, h5ad or any binary over 5 MB. In multiple-choice mode the ideal answer is
necessarily on screen as one of the options. The mounted host paths still show where the
repository is on the host (user name included).

## One run per capsule (default) or per question

The paper describes capsule-level runs; the official repository's code runs each question on
its own. The two do not match (a finding of the grading audit of this adapter), and nothing
here establishes which produced the published numbers. The default here is one run
per capsule with all its questions, because loading and understanding the data is most of the
token cost and is shared (59 runs instead of 205 per solver). Both solvers get the same unit,
so the comparison between them is fair, but with any number state the unit: questions of a
capsule can hint at each other, and one bad data-loading decision can cost several questions
at once (which is why the report gives capsule-level tests). `--unit question` does what the
repository's code does, at roughly three times the cost.

## The swarm

```
analyst ──▶ seal + check ──▶ critic (blind) ──▶ code compares ──▶ reconciler ──▶ code writes
derives     analyst's files   derives every      answers and        re-derives     answers.json
answers     moved away        answer again       method lines       by script      METHODS.md, FINDINGS.md
```

- **Analyst** (user `deriv_a`): the single agent's job.
- **Critic** (user `deriv_b`): the same job, from nothing. Its prompt is built by a function
  that is not given the ledger: the questions and its own instructions, no answer, route,
  method or path of the analyst's (a guard refuses a prompt that holds any). Before it starts,
  root kills every process of the analyst's user, selected by uid (a process renamed to
  `inspect-sandbox-tools` used to survive and could serve data on loopback); moves every file
  that user owns outside its home into a root-only folder (moved, not just made unreadable: a
  file name can carry an answer); takes ownership of the analyst's home; empties `/outputs`;
  empties `/dev/mqueue` (a separate mount the file sweep never visited); removes every System V
  shared-memory segment, message queue and semaphore (as the analyst's user too: a container's
  root may not remove another user's); and gives the critic new empty `work` and `tmp`
  directories. Then a check runs as the critic's own user for all of these: a file, a process
  of the analyst's user, a message queue, a System V object. If any is there, the critic does
  not run and the answers stay `unchecked`.
- **Reconciler** (root): runs whenever a question has two answers. It is shown both answers
  under the labels A and B, each side's one-line method, and the commands each side ran with
  their output, taken from the transcripts by code; not the routes or evidence the roles
  wrote. It records nothing by assertion: `rederive` takes a script the reconciler wrote under
  `/root/reconcile`, the harness runs it, and the answer must be the value on its last output
  line. The script must read `/data` and must not read the analysts' directories.
  - Disagreement: every one must be re-derived. Code then works out which side the value
    supports (A, B, both, neither) and the ledger records that; a reconciler that runs no
    script leaves the question `disputed`.
  - Agreement: both derivations state their method in one line (`data=...; subset=...;
    procedure=...; tool=...`), and code compares the two lines (token overlap of 0.5 or more
    is "same method"). An agreement by the same method, or one where a side's answer was a
    forced estimate, is flagged as weaker and listed for a spot check. If the reconciler's own
    derivation then differs and it names where the shared method departs from the question,
    its value is reported (`reconciled`). An agreement by different methods cannot be
    overturned by the reconciler's one derivation; a differing spot check is recorded in the note.

Statuses are computed in `answers.py` (the overturn rule in `solvers.final_answers`), never by
a model: `replicated` (two derivations agree),
`reconciled` (they did not, or agreed by the same method and were overturned; the reconciler's
re-derived value is reported), `disputed` (unresolved; the analyst's answer is reported and
flagged), `unchecked` (one derivation; always the case for the single agent),
`specification-sensitive` (would be `unchecked` or `replicated`, but a role recorded with its
answer a result it got under another defensible reading, `alternatives` of `submit_answer`,
and that result differs from its answer by more than the comparison below tolerates; in the
swarm such an agreement is also sent to the reconciler as a weak one), `missing`. Two
numbers agree when equal, or for non-integers within 1% or when one is the other rounded;
integers must be equal; text agrees only when identical after removing case and punctuation,
otherwise it goes to the reconciler. Numbers are compared as numbers only (-4.96 and 4.96
differ).

Both solvers get the same working rules and answer contract (`roles.rules`): a number is
digits only, except that a question about an effect, impact, relationship or significance is
answered with a short conclusion followed by the value; each `python` tool call starts a new
interpreter (said plainly, because a quarter of the pilot's model calls were NameError
retries), while `bash_session` keeps its shell.

Why three roles and not the nine of the BixBench3 swarm: a v1.5 capsule is a few small tables
and questions that take minutes, not hours of pipeline work with an output contract. Scout,
proposer, pilot and experimenter are one role; the methods auditor is the critic's own reading
of the question; the finisher is a code rule (a question the analyst missed takes the critic's
answer); the reporter is code. The p-value/e-value ledger of BixBench3 is not used: the test
that fits "the answer to Q is X" is replication, and inventing p-values for it would be worse
than not having them.

Budgets. `--max-tokens` and `--time-limit` are per run; `--max-tokens` is what the single agent
may spend. The swarm's tokens are planned in `solvers.plan_budget`:

- Each role has a floor from the number of questions n: a derivation 50,000 + 35,000 n, the
  reconciler 30,000 + 10,000 n (`BudgetPolicy`).
- `equal` (default): the swarm's total is the single agent's budget. The analyst may spend the
  total minus the two later floors, the critic what is left minus the reconciler's floor, the
  reconciler the rest. What a role does not use rolls forward. Read the result as "same budget".
- `extended`: the analyst gets the single agent's whole budget and the swarm's total is 2.25
  times that. Read the result as "more budget"; `run.json` says which.
- If the total cannot hold the three floors, the run is refused before staging, with the number
  it would need. It does not start and fail in a later role.
- A solver that stops (limit or not) with questions unanswered gets one forced final turn,
  from a 15,000-token reserve inside its budget: a short prompt with the tail of its own work
  log and no tool but `submit_answer`. Such answers are marked forced and, in the swarm,
  treated as weak. The single agent gets the same turn from the same reserve: it works up to
  `--max-tokens` minus 15,000, exactly as the analyst works up to its allowance minus 15,000.
- A `submit_answer` call made in the model call that crosses a limit is executed before the
  limit takes effect, for both solvers (it used to be dropped). Nothing else in that call runs.
  Inspect's own hard stop at 1.25 times the total is not softened this way.

A model call is charged its whole context, cached or not; limits are checked after each call,
so a phase can end one call over; Inspect stops a run outright at 1.25 times its total. Both
solvers compact their context at 100,000 tokens. Time is still split by share (42% per
derivation, 16% held for the reconciler). Documentation search and lessons memory (the BixBench3
swarm's extras) are not wired into this solver at all, so both are off and `run.json` says so.

## Grading

Official code: [Future-House/BixBench](https://github.com/Future-House/BixBench) at commit
4931118. It has two graders: `bixbench/graders.py` (per `eval_mode`, called by
`grade_outputs.py`) and `bixbench/postprocessing.py` (the paper's agent runs: one LLM prompt for
every open answer, whatever its `eval_mode`). Three profiles here; the judge prompts are the
official ones verbatim.

| eval_mode | `per-mode` (default, ours) | `official` (= graders.py) | `paper` (= postprocessing.py) |
|---|---|---|---|
| str_verifier | two numbers: equal as numbers, decided in code (off by a factor of 100 or a percent sign: LLM judge, with a note); otherwise equal after keeping letters and digits, lower case; else LLM judge | normalised equality; else "answer is a substring of the ideal"; else LLM judge | one binary LLM prompt; correct only if the reply is exactly `1` |
| range_verifier | answer parsed as one number, lower ≤ x ≤ upper, in code; out of range but in range after a factor of 100, or carrying a percent sign: LLM judge with a note; not one number: LLM judge. Both with the official range prompt | always the LLM judge, with the same generic open-answer prompt as llm_verifier (upstream's range prompt exists but no code path reaches it) | same binary prompt |
| llm_verifier | LLM judge (skipped if both are the same number, or neither is a number and they are equal after normalising) | LLM judge | same binary prompt |

Which judge applies where. Each profile has its own default (`grading.PROFILE_JUDGES`), used
unless `--judge-model` or `--judge-temperature` is given:

| Profile | Default judge | Default temperature | Why |
|---|---|---|---|
| `per-mode` | `openai/gpt-4o` | 0 | ours, for repeatability |
| `official` | `openai/gpt-4o` | 1.0 | `grade_outputs.py`'s defaults |
| `paper` | `anthropic/claude-3-5-sonnet-20241022` | provider default | `postprocessing.py` |

`grade.json` records, per profile, the judge and temperature used and every deviation from
that profile's default; the report repeats them and calls out temperature 0 with `official` or
`paper`. Every judge call is behind `NO_PAID_CALLS`.

Differences from the official code:

1. An empty answer is incorrect with no judge call, and it stays in the denominator. Upstream
   differs. In `graders.py` an empty string is a substring of every ideal and is graded
   correct in str_verifier. Through upstream's CSV path an empty answer becomes the text
   `nan`. And upstream's paper path drops empty answers from the denominator, where this
   adapter counts them as incorrect: with unanswered questions, accuracy here is lower than
   the same answers would score there. (The last two are findings of the grading audit; they
   were not re-derived from upstream's code here.)
2. `per-mode` does not use the substring rule, which accepts "6" for an ideal of "166".
3. `per-mode` compares numbers as numbers (1.9E-05 = 1.9e-5 = 0.000019) and never as
   normalised strings: normalising drops "-" and ".", so an ideal of -4.96 used to accept 4.96
   and 49.6, and 1.5 accepted -15.
4. `per-mode` checks ranges in code instead of asking the judge, and swaps the bounds of the two
   v1.5 rows whose ideal is written upper bound first (official code would never accept those
   in its numeric path).
5. A judge call that fails three times is recorded as `judge_error`, counted as incorrect and
   reported separately as ungraded; an accuracy with ungraded answers is labelled a lower
   bound. Officially a failed call is dropped or raises.
6. Refusals. Upstream has them only for the multiple-choice refusal option. In `official` and
   `paper` an open answer is never `refused`; our own count (no answer, or the judge replied
   `refused`) is the separate field `own_refused`. Precision (correct / not refused) is
   reported only in `mcq-refusal` mode.
7. Multiple choice (`--answer-mode mcq`, `mcq-refusal`): the solver itself picks a letter and it
   is matched to the correct letter, as `MCQGrader` does; choosing "Insufficient information to
   answer the question" is a refusal. The paper instead has a second LLM pick the letter from
   the agent's notebook; that is not implemented. Options are shuffled with a per-run host-only
   salt (officially unseeded). Not exercised with a real model yet.

The report (`report.py`) opens with a banner: grading profile, judge, answer mode, repeats,
unit, network state, questions covered out of 205, and "Comparable to published: no" with the
reasons, unless every condition holds (a real model; `official` or `paper` with its default
judge and temperature; all 205 questions; nothing ungraded; one run per question; network on).
This sandbox has no network, so today that line always says no. Then, per solver and per
eval mode: accuracy with counts and a Wilson 95% interval (as the official code), the mean of
the per-repeat accuracies, and `strict` accuracy (correct without the judge). Rows are keyed
by (model, solver, question, repeat); the same key twice is an error and runs of different
models are refused, not pooled. The paired comparison is over (question, repeat) pairs graded
on both sides (it says how many were dropped) and gives:

- a sign-flip permutation test on per-capsule sums of (swarm correct minus single correct),
  exact for up to 20 capsules with a difference and Monte Carlo above that. This is the test
  to read: its unit is the capsule;
- the exact McNemar test, which assumes independent questions and is therefore too confident
  when capsules hold several (the report says so next to the number);
- a bootstrap interval that resamples capsules, given only with at least 10 capsules and one
  discordant pair; otherwise "not estimable".

## Sandbox image

`futurehouse/bixbench:aviary-notebook-env`, the image the official README tells you to pull.
It is published for linux/arm64 only: 5.66 GB compressed, 18.3 GB on disk, 158 s to pull on
this machine (Apple Silicon, runs natively). Debian 12, Python 3.12 (pandas, scipy, statsmodels,
scanpy, pydeseq2, gseapy, biopython), R 4.3.3 (DESeq2, clusterProfiler, org.Hs.eg.db, fgsea,
apeglm), mafft, iqtree2, clipkit, phykit, blastn. Not in it: edgeR, limma, org.Mm.eg.db,
Seurat, msigdbr, ReactomePA. An x86-64 host would need emulation or its own build
(we made one for Modal: see the next section). `run.json` records the image id.

## The sandbox on Modal (`--sandbox modal`)

What it is. With `--sandbox modal` the analysis of a run (the commands the solver runs on the
capsule's data) happens in a [Modal](https://modal.com) Sandbox and not in local Docker.
Everything else stays where the command runs: Inspect, the model calls, the question file, the
answer key, grading, the run folder. Without the option nothing changes: the default is local
Docker with the official image.

**Not comparable.** The official image exists for linux/arm64 only and Modal runs linux/amd64
only. So a Modal run uses our own amd64 rebuild of that image (`bixbench-v1-env:amd64-1`). It
is close, and it is not the official image. A score from a Modal run is **not comparable with
published BixBench numbers and not comparable with a local Docker run or the earlier local
pilot**. Do not put Modal runs and Docker runs in one table. A comparison between models or
between the two solvers is fair when every run of it used this same Modal image.
`run.json` records `settings.sandbox` ("docker" or "modal"), the image name and the image id.
No real model has run in this sandbox yet: everything below was measured with the scripted
model (`--model mock`) or with no model.

How close the image is (all files are in [`image/`](image/), made by code, not by hand):

| What | Official arm64 image | Our Modal amd64 image |
|---|---|---|
| Base | `continuumio/miniconda3:24.9.2-0`, Debian 12.7 | the same tag, amd64 variant |
| Python, R | 3.12.2, R 4.3.3, OpenBLAS 0.3.28 | the same |
| Conda packages (843) | | 840 at the same version. 3 differ: `reproc` and `reproc-cpp` 14.2.5 for 14.2.4 (the amd64 `mamba` needs it), `kernel-headers_linux-64` 3.10.0 for 4.18.0 (compiler headers). 387 are the identical file; the other 453 are the same version built for the other processor. |
| R packages (333) | | all 333 at the same version |
| Python packages as pip lists them (254) | | the same 254 versions; pip also lists `PyQt5`, which conda installs in both |
| Debian packages (268) | | 266 at the same version; `wget` differs by a rebuild number; one library exists only on each processor (`libhwasan0`, `libquadmath0`) |
| Tools (mafft, IQ-TREE, BLAST, FastQC, SPAdes, ...) | | same versions; the udocker BUSCO image has the same layers |
| Environment variables | PATH, LANG, LC_ALL, DEBIAN_FRONTEND | Modal adds 12 more (for example `PYTHONHASHSEED=0`, `PYTHONPATH`). The provider starts every command without them. |

The full list by package name: [`image/DIFF.md`](image/DIFF.md) and `image/diff.json`. What
cannot be matched: every compiled package is a different binary for a different processor, and
the kernel is Modal's gVisor, not Linux in Docker.

The same fixed analysis in both images (`image/tools/equivalence.py`: seeded synthetic data, no
model, one thread; numpy, scipy, statsmodels, scikit-learn, PyDESeq2, scanpy, R with DESeq2,
apeglm and clusterProfiler, mafft, IQ-TREE, BLAST): 419 values. Every text and integer result
is identical (alignments, tree topology, BLAST hits, counts of significant genes, gene
rankings). Double-precision numbers agree to at least 10 significant digits (12 or more
everywhere but one curve fit); scanpy's single-precision numbers agree to 5 to 7. So an answer
rounded to a few digits should not change, and a last digit of a long number can. Details:
[`image/EQUIVALENCE.md`](image/EQUIVALENCE.md).

How to run. Needs a Modal account (`modal token new` once) and the optional packages:

```bash
uv sync --group modal                     # once: inspect-sandboxes 0.6.1 and modal 1.6.1
# One capsule, scripted model (billed for sandbox seconds only: about a cent)
NO_PAID_CALLS=0 uv run --group modal bixbench-v1 run --capsules bix-46 --model mock \
    --sandbox modal --out runs/modal-try
# Real model: the same options as a Docker run, plus --sandbox modal
NO_PAID_CALLS=0 uv run --group modal bixbench-v1 run --capsules bix-46 --solvers single,glhf \
    --model anthropic/claude-sonnet-5-5 --max-tokens 320000 --time-limit 1800 \
    --sandbox modal --out runs/modal-bix-46
NO_PAID_CALLS=0 uv run --group modal bixbench-v1 modal-sandboxes   # is anything still running?
```

Options: `--modal-cpu` (default 4 cores), `--modal-memory-gib` (default 16), `--modal-usd-cap`
(default 5: a run does not start if the folder's sandbox spend plus the most this run could
cost would pass it). `--sandbox modal` is a paid call: it is refused unless `NO_PAID_CALLS` is
exactly `0`, like a real model. The image is built once with
`uv run --group modal python -m bixbench_v1.modal_image build` (10 minutes); it is already
published in the owner's workspace.

What goes to Modal: the staged data files of the capsules you run (the same files Docker
mounts at `/data`), once per capsule, into the Volume `bixbench-v1-staged-f8cc3bdc` under a
folder named by a hash. Never uploaded: the question file, a capsule zip, a notebook, the
staging manifest, the shuffle salt, a run folder, any key. The sandbox is created with no
environment, no secret and no network.

Integrity, each checked in a real Modal sandbox (`tests/modal_sandbox_cloud_test.py`, opt-in
and billed; `tests/modal_sandbox_*_test.py` without the cloud):

| Rule | How on Modal | Result on Modal |
|---|---|---|
| No network | `block_network=True`; a probe in every sandbox, before the solver, must fail to reach anything, or the run stops | TCP, DNS and HTTPS all fail from inside |
| Only the staged data, read-only | one Volume folder, mounted read-only, copied to a real `/data` owned by root; file names, sizes and SHA-256 of every file must equal the host's, or the run stops | holds; the role users cannot write to `/data` (root can, in its own sandbox only; the Volume cannot be written) |
| No answers, no salt, no key | nothing is passed in; the probe looks for secret-like variables and answer files | no capsule id, answer text or salt in files, environment, mount table or Modal's own container arguments |
| Blind critic | the critic gets **its own new sandbox**; the analyst's sandbox is terminated first; the adapter's blind check then runs in the new one | passes. In ONE sandbox it does not: see below |
| Limits and timeout | CPU and memory request = limit; lifetime = time limit + 180 s + 600 s, at most 24 h | holds; past the memory limit Modal ends the whole sandbox, not only the process |
| Nothing left running | every sandbox is terminated at the end, on an error and on Ctrl+C or `kill`; a last check by tag terminates anything left | sandboxes listed afterwards: none |

Why the critic needs its own sandbox. Under gVisor (Modal's runtime) there is no
`/proc/sysvipc` and no `/dev/mqueue`. We re-ran the adapter's blind check there with the three
known side channels planted (`image/gvisor-blind-check.json`):

| Side channel | The adapter's check in one Modal sandbox | With a new sandbox for the critic |
|---|---|---|
| A background process disguised by name | passes (killed by uid, as in Docker) | passes |
| `/dev/mqueue` | fails open: the check has nothing to list; no message can be sent, but a queue the analyst made still exists for the critic, and a name can carry an answer | passes (the queue does not exist) |
| System V shared memory and message queue | **fails**: `ipcrm -a` removes nothing, the check sees nothing, and the critic's user reads the analyst's data | passes (the objects do not exist) |

So on Modal the swarm uses two sandboxes one after the other: the analyst's, then a new one for
the critic and the reconciler. The analyst's scripts are kept on the host and added to
`outputs/glhf/work/deriv_a/` at the end. If the new sandbox cannot be made, the critic does not
run. Local Docker is unchanged (one container, the full check).

The same mechanics. The three pilot capsules, both solvers, scripted model, once in Docker and
once on Modal: the same statuses, phases, tool calls, tool outputs (the machine name in a
shell prompt aside), output files and `answers.json` in all six runs
(`image/mock-equivalence.json`, made by `image/tools/compare_runs.py`).

Cost. Modal's prices for sandboxes, read with `modal billing rates` on 2026-11-15: 0.1419 USD
per core per hour and 0.024 USD per GiB per hour; Volumes 0.09 USD per GiB per month. The
default sandbox (4 cores, 16 GiB) is 0.95 USD per hour. Each sandbox gets one line in
`<out>/<capsule>/<solver>/modal_ledger.jsonl`, `<out>/modal_ledger.jsonl` and the cumulative
`runs/modal_ledger.jsonl` (seconds from create to terminate as this machine measured them;
Modal's own `modal billing report` is the authority). `budget.json` repeats seconds and dollars
per run, and the command prints a per-capsule table at the end.

| | Sandbox seconds | Cost |
|---|---|---|
| Measured, scripted model, per capsule (single + swarm, 3 sandboxes) | 45 to 55 | 0.012 to 0.015 USD |
| Estimate, real model, per capsule: the pilot's 51 s + 84 s, plus 10 s per sandbox | about 165 | about 0.04 USD |
| Estimate, all 59 capsules, both solvers, at that speed | about 9,700 | about 2.6 USD |
| The same at 3 minutes per run | about 23,000 | about 6 USD |

The estimates are arithmetic, not measurements: no real model has run here. A sandbox adds
about 10 seconds to a run (start, copy the data in, probe, copy the outputs out).

How to clean up. A run ends its own sandboxes. After a process that was killed outright
(`kill -9`, a crash of the machine), sandboxes live until their own timeout; end them with
`NO_PAID_CALLS=0 uv run --group modal bixbench-v1 modal-sandboxes --terminate`. To remove what
is stored: `modal volume delete bixbench-v1-staged-f8cc3bdc` (the staged data; uploaded again
when needed) and `modal image names delete bixbench-v1-env:amd64-1` (then build it again
before the next run). `modal app list` shows the app `bixbench-v1-sandbox`; it holds no
running container between runs and costs nothing while idle. `modal app stop
bixbench-v1-sandbox --yes` removes it; the next run makes it again (checked: the published
image stays).

Known limits of the Modal path:

- Not comparable with Docker runs or published numbers (above).
- Past its memory limit the whole sandbox ends and the run fails; in Docker only the process
  dies. Use `--modal-memory-gib` for large capsules.
- `/outputs` is copied to the host when the run ends. If the machine that runs the command
  dies mid-run, that run's outputs are lost (it is run again; the sandbox ends at its timeout).
  After Ctrl+C the sandbox is terminated and gets its ledger line, but its outputs may not be
  collected; the run is recorded as failed and runs again next time.
- Results can differ in a last digit between Modal's own machines (different processors
  choose different math kernels), as they do between the two images.
- The `modal` package here is 1.6.1, because inspect-sandboxes 0.6.1 does not import with
  1.6.2 or later. The `modal` command line tool can be newer.
- Two runs of the same capsule must not start at the same moment on one machine: they share
  the local staged folder (true for Docker too).

## Problems to know about

- **Replicated is not the same as correct.** In the three-capsule pilot the analyst and the
  critic agreed on six answers; two were graded correct and four wrong (all four wrong ones in
  one capsule). The critic had been shown the analyst's route. The route hint is gone and same-method agreement is now flagged and
  spot-checked, but none of this has been run with a real model yet. Two blind derivations by
  the same model can still make the same choice where a question leaves one open.
- **The swarm costs more than one derivation.** Two full derivations plus the reconciler, which
  now runs on every capsule. At an equal budget on a capsule where one analysis takes about
  half the budget, the second derivation or the reconciler will be short; the forced final
  turn then records estimates, not finished work. Roles cannot see how much budget is left.
- **The same-method test is crude.** It compares the words of two self-reported lines. It errs
  towards "same" (which only adds a spot check), but a role can describe the same computation
  in different words, or two computations in the same words.
- **The reconciler's script check can be gamed.** The harness verifies that the value came out
  of a script that mentions `/data` and not the analysts' directories; it cannot verify that
  the script is a real analysis. The role is told to derive; nothing proves it did not hardcode.
- **No network vs. the questions.** At least 17 of the 205 questions (6 capsules) name an online
  resource (KEGG, Reactome, Enrichr through gseapy, MSigDB). The official harness leaves the
  network on. With `network_mode: none` those questions cannot be answered as asked, for either
  solver. Report them separately or allow a gene-set mirror; this is a decision, not a bug.
- Docker Desktop here has 7.7 GB of memory. The six bix-61 capsules (about 1 GB each of reads
  and indexes) and the 380 MB phylogenetics capsules may need more, and long alignments may
  not fit a 30-minute limit.
- On macOS, bind mounts ignore Unix ownership, so the role users' homes are on the container's
  own filesystem and only small scripts are copied to `outputs/glhf/work/` at the end.
- Blindness covers what was found and tested: files the analyst's user owns on the
  container's own filesystem, `/tmp`, `/var/tmp`, `/dev/shm`, `/run` and `/outputs`; its
  processes; `/dev/mqueue`; System V IPC. A file the analyst only modified but does not own
  would not be found (not audited for the official image). Killing by uid also ends the
  analyst's idle shell, which is intended. Other kernel objects were not audited.
- **Specification-sensitive depends on the role saying so.** The status is computed from the
  alternatives a role chose to record. A role that ran one reading, or kept quiet about the
  other, is not flagged.
- The conclusion-plus-value answers allowed for effect and significance questions are text, so
  two derivations of such a question are compared as text ("unclear" unless identical) and go
  to the reconciler, and `per-mode` grading sends them to the judge.
- The token count is Inspect's `total_tokens`, which includes cached input. Dollar cost is
  therefore much lower per token than the list input price; `report.py` prices each kind
  separately with assumed prices (`DEFAULT_PRICES`) that should be checked.
