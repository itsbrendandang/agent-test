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

# One capsule, both solvers, real model (keys come from the repo's .env, never printed):
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

Other options of `run`: `--unit question` (one run per question, as the official harness does),
`--answer-mode mcq|mcq-refusal`, `--role-model critic=openai/gpt-5.5`, `--judge-model`,
`--judge-temperature`, `--no-judge`, `--seed`, `--image`, `--force`. `--critic-hints` is still
accepted and is ignored: the critic is never shown anything of the analyst's. The swarm's
budget mode is set with the environment variable `BIXBENCH_V1_SWARM_BUDGET=equal|extended`
(default `equal`) or `run_capsule(swarm_budget=...)`; there is no command-line option for it yet.

Runs go to `runs/<name>/<capsule>/<solver>/`: `outputs/answers.json`, `outputs/METHODS.md`,
`outputs/glhf/{ledger.json, FINDINGS.md, work/}`, `logs/*.eval` (every model call), `run.json`
(all settings, image id, token usage, phases) and `grade.json`. A swarm run also writes
`outputs/glhf/questions.json` (per question: analyst answer, critic answer, agreed, same
method, reconciler answer, whether the reconciler changed it) and `outputs/glhf/evidence.json`
(the commands behind each answer); `run.json` repeats the first as `questions` and adds
`budget` (single-agent budget, the solver's total, tokens used, tokens per phase, forced
answers, and whether the run reads as "same budget" or "more budget"). `runs/` and `glhf/data/` are
gitignored. Never commit benchmark data.

## Integrity boundary

What the solver can see is fixed by code, and each rule has a test.

| Rule | Where | Test |
|---|---|---|
| Only `question_id`, the question text and (multiple choice only) the shuffled options cross into the task. `PublicQuestion` forbids any other field, so a dataset row cannot be passed through. | `dataset.py` | `test_boundary.py` |
| The answer key is never given to Inspect: the task has no target and no scorer, so the key is in no prompt, sample, metadata or eval log. | `task.py`, `runner.py` | `test_boundary.py`, `test_e2e.py` (searches the log file for sentinel strings) |
| The prompt is checked for the capsule's hypothesis, result, paper link, canary and long ideal answers before a run starts. | `runner.check_prompt` | `test_boundary.py` |
| Staging is an allow-list: only files under the capsule's `CapsuleData-*` folder are copied. Dropped: the `CapsuleNotebook-*` folder, any path with "notebook" in it, `.ipynb/.Rmd/.qmd`, rendered reports (`.html/.pdf/.md/.docx`), scripts (`.py/.R/.jl`), nested archives that contain a notebook or report or cannot be read, symlinks, unsafe paths. | `staging.py` | `test_staging.py` |
| The staged folder is verified before every run (exactly the manifest's files, no forbidden type) and scanned for the secret strings. A mismatch stops the run before any container starts. | `staging.verify_staged`, `leak_scan` | `test_staging.py`, `test_e2e.py` |
| The sandbox has no network and mounts two things: the staged data read-only at `/data`, and `/outputs`. The zip, the question file and the notebooks stay on the host. No API key is in the container. | `sandbox/compose.yaml` | `test_boundary.py` (parses the file), `test_e2e.py` (a probe inside the container) |
| Grading runs on the host after Inspect has returned and the container is gone. It refuses an unfinished run. The judge gets the question, the ideal and the answer string only. `grade.json` and `report.json` hold verdicts, not ideals. | `runner.grade_run`, `grading.py` | `test_e2e.py`, `test_grading.py` |

`bixbench-v1 audit` on the v1.5 files: 1,084 data files (13.5 GB unpacked) staged from 64 zips,
49 notebooks dropped (43 in notebook folders, 6 executed notebooks inside data folders of zips
the question file does not use), nothing else dropped, every prompt clean.

Known limits. Data folders hold intermediate results the benchmark authors provide as inputs
(for example DESeq2 result objects); they are staged, as in the official harness. The leak scan
reads plain files up to 5 MB and does not look inside xlsx, gz or rds. In multiple-choice mode
the ideal answer is necessarily on screen as one of the options.

## One run per capsule (default) or per question

The official harness runs each question alone. The default here is one run per capsule with all
its questions, because loading and understanding the data is most of the token cost and is
shared (59 runs instead of 205 per solver). Both solvers get the same unit, so the comparison is
fair, but two things differ from the official protocol and should be stated with any number:
questions of a capsule can hint at each other, and one bad data-loading decision can cost
several questions at once (which is why the report gives a capsule-level bootstrap interval).
`--unit question` gives the official protocol at roughly three times the cost.

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
  root moves every file the analyst's user owns outside its home into a root-only folder (moved,
  not just made unreadable: a file name can carry an answer), takes ownership of the analyst's
  home, empties `/outputs`, and gives the critic new empty `work` and `tmp` directories. Then a
  check runs as the critic's own user; if it can see anything of the analyst's, the critic does
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
flagged), `unchecked` (one derivation; always the case for the single agent), `missing`. Two
numbers agree when equal, or for non-integers within 1% or when one is the other rounded;
integers must be equal; text agrees only when identical after removing case and punctuation,
otherwise it goes to the reconciler.

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
- A derivation that stops (limit or not) with questions unanswered gets one forced final turn,
  from a 15,000-token reserve inside its allowance: a short prompt with the tail of its own
  work log and no tool but `submit_answer`. Such answers are marked forced and treated as weak.
  The single agent has no such turn (its code is unchanged since the first pilot); it never
  hit a limit there, but on a capsule where it does, this is an advantage for the swarm.

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
official ones verbatim; the default judge is `openai/gpt-4o`, the official default.

| eval_mode | `per-mode` (default) | `official` (= graders.py) | `paper` (= postprocessing.py) |
|---|---|---|---|
| str_verifier | equal after keeping letters and digits, lower case; else equal as numbers; else LLM judge | same equality; else "answer is a substring of the ideal"; else LLM judge | one binary LLM prompt |
| range_verifier | answer parsed as one number, lower ≤ x ≤ upper, in code; an answer that is not one number goes to the LLM judge with the official range prompt | always the LLM judge with the range prompt | same binary prompt |
| llm_verifier | LLM judge (skipped if equal after normalising) | LLM judge | same binary prompt |

Differences from the official code:

1. An empty answer is incorrect with no judge call. Officially an empty string is a substring of
   every ideal and is graded correct in str_verifier. (All profiles.)
2. `per-mode` does not use the substring rule, which accepts "6" for an ideal of "166".
3. `per-mode` compares numbers as numbers (1.9E-05 = 1.9e-5 = 0.000019) before asking a judge.
4. `per-mode` checks ranges in code instead of asking the judge, and swaps the bounds of the two
   v1.5 rows whose ideal is written upper bound first (official code would never accept those
   in its numeric path).
5. Judge temperature is 0 by default (official default 1.0), for repeatability.
6. A judge call that fails three times is recorded as `judge_error`, counted as incorrect and
   reported separately as ungraded. Officially a failed call is dropped or raises.
7. Multiple choice (`--answer-mode mcq`, `mcq-refusal`): the solver itself picks a letter and it
   is matched to the correct letter, as `MCQGrader` does; choosing "Insufficient information to
   answer the question" is a refusal. The paper instead has a second LLM pick the letter from
   the agent's notebook; that is not implemented. Options are shuffled with a seed (officially
   unseeded). Not exercised with a real model yet.
8. The report gives accuracy with counts and a Wilson 95% interval (as the official code), per
   solver and per eval mode, plus `strict` accuracy (correct without the judge), precision over
   non-refused answers, the paired comparison (discordant counts, exact McNemar test) and a
   bootstrap interval that resamples capsules.

## Sandbox image

`futurehouse/bixbench:aviary-notebook-env`, the image the official README tells you to pull.
It is published for linux/arm64 only: 5.66 GB compressed, 18.3 GB on disk, 158 s to pull on
this machine (Apple Silicon, runs natively). Debian 12, Python 3.12 (pandas, scipy, statsmodels,
scanpy, pydeseq2, gseapy, biopython), R 4.3.3 (DESeq2, clusterProfiler, org.Hs.eg.db, fgsea,
apeglm), mafft, iqtree2, clipkit, phykit, blastn. Not in it: edgeR, limma, org.Mm.eg.db,
Seurat, msigdbr, ReactomePA. An x86-64 host would need emulation or its own build.
`run.json` records the image id.

## Problems to know about

- **Replicated is not the same as correct.** In the three-capsule pilot the analyst and the
  critic agreed on four answers and all four were graded wrong; the critic had been shown the
  analyst's route. The route hint is gone and same-method agreement is now flagged and
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
- Roles can see each other's process list (`ps`). Files are covered wherever the analyst's
  user owns them on the container's own filesystem, `/tmp`, `/var/tmp`, `/dev/shm`, `/run` and
  `/outputs`; a file the analyst only modified but does not own would not be found (not audited for the
  official image).
- The command line has no option for the swarm budget mode; its `--total-token-cap` check
  reads the mode from `BIXBENCH_V1_SWARM_BUDGET`, so set the mode there and nowhere else.
- The token count is Inspect's `total_tokens`, which includes cached input. Dollar cost is
  therefore much lower per token than the list input price; `report.py` prices each kind
  separately with assumed prices (`DEFAULT_PRICES`) that should be checked.
