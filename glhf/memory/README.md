# Swarm memory

The swarm keeps process lessons between runs. A person must approve each lesson before any
later run sees it.

| File | Written by | Read by runs |
|---|---|---|
| `lessons.pending.md` | runs with `--memory` | never |
| `lessons.md` | a person, with the `approve` command | yes |

`lessons.pending.md` does not exist until the first lesson is queued. A new clone has only
`lessons.md`. With no pending file, `list` prints `0 pending`.

Neither file is ignored by git, so the team can share them. Commit `lessons.pending.md` if
you want a teammate to review the lessons.

## How a lesson is written

A run with `--memory` asks the Reporter for at most 8 lessons of one line each: tool problems
and their fixes, format problems, what took the most time. Code (`swarm/memory.py`) then:

1. cuts the text at 2,000 characters;
2. drops every line that looks like a result (see "The filter");
3. adds the remaining new lines to `lessons.pending.md`, under a heading with the task, the
   time and the "context": the tasks whose lessons that run was shown.

Nothing is sent to past.dev at this step. Runs with the scripted model (`--model mock`) write
to their own run folder, not to this folder.

## How to approve or reject

Run these from `glhf/bixbench`. A Python warning about `sys.modules` may appear; ignore it.

```bash
uv run python -m bixbench3.inspect_harness.swarm.memory list
uv run python -m bixbench3.inspect_harness.swarm.memory approve 1 3
uv run python -m bixbench3.inspect_harness.swarm.memory reject 2
uv run python -m bixbench3.inspect_harness.swarm.memory approve-all
uv run python -m bixbench3.inspect_harness.swarm.memory reject-all
```

- `list` shows each pending lesson with a number, its task and its context.
- `approve` moves the lesson to `lessons.md`. With `PAST_API_KEY` set, it also sends the
  approved lessons to past.dev. Add `--no-past` before the command to skip that.
- `reject` deletes the lesson.
- The numbers change after each `approve` or `reject`. Run `list` again first.
- `--dir FOLDER` (before the command) uses another memory folder.
- A line the filter refuses cannot be approved. Reject it, or rewrite it in the pending file.

Approve a lesson only if it is about process. Reject it if it tells anything about a task's
data or answers: a gene, a sample, a file name, a number from the data, which samples to drop,
what the analysis found.

## How lessons are read

A later run with `--memory` gives the approved lessons to every role. Rules:

- A lesson is never shown to a run on the task that wrote it.
- A lesson is never shown to a run on a task in its context. Example: a run on task Y reads a
  lesson from task X and writes its own lesson. That lesson has context X, so no run on task X
  sees it. This stops a result from going X to Y and back to X in other words.
- Only the newest lessons that fit in 6,000 characters are used.
- Each line is filtered again when it is read.
- With `PAST_API_KEY` set, the run asks past.dev for lessons first, with a fixed question (no
  text of the task is sent). The same two rules apply to what past.dev returns. If past.dev
  fails or returns nothing, the run uses `lessons.md`.

## The filter

The filter is a second protection. The approval step is the main one. The filter drops a line
that contains:

- a score, the grader or the answers;
- a study, dataset or paper identifier (GEO, SRA, DOI, PubMed and similar), also when it is
  written with spaces, hyphens, an underscore after it, or unusual characters;
- a word that belongs to a result: answer, expected, result, top hit, fold change, FDR, padj,
  p-value, outlier, up-regulated, significant, marker, "the paper", and similar;
- a name that mixes letters and digits (TP53, Sox2, brca1, rep3, S9), unless it is a known tool
  or format (HISAT2, GRCh38, sha256). Version numbers such as 2.7.10b are allowed;
- a name such as KO_3 or rep-2;
- a percentage, a number in scientific notation, a number with 4 or more digits (also 1,234),
  a decimal with 3 or more places, or more than 3 numbers.

The filter drops some harmless lines. It cannot catch a gene name without a digit (MYC) or a
result written in plain words. That is why a person reads every lesson.

## Rules for people

- Process only. No result values, gene lists, scores or anything that shows a task's answers.
- You may edit or delete lines in both files. A wrong lesson costs time in later runs.
- Do not edit the `## Task ...` headings. Code uses them to know which task a lesson is from
  and which tasks must not see it.
