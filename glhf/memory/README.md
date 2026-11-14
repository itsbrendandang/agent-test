# Swarm memory

`lessons.md` holds process lessons that the swarm keeps between runs. It is in git, so the team
shares it.

## How it is written

A run with `--memory` asks the Reporter for at most 8 lessons of one line each: tool problems
and their fixes, format problems, what took the most time. Code (`swarm/memory.py`) then:

1. cuts the text at 2,000 characters;
2. drops every line that looks like a result (a score, a study or gene identifier, a
   percentage, a number that looks like data);
3. adds the remaining lines that are new to `lessons.md`, under a heading with the task and
   the time.

Runs with the scripted model (`--model mock`) write to their own run folder, not to this file.

## How it is read

A later run with `--memory` gives the lessons to every role. Rules:

- Lessons from a run on task X are never shown to a run on task X.
- Only the newest lessons that fit in 6,000 characters are used.
- Each line is filtered again when it is read.
- With `PAST_API_KEY` set, the run asks past.dev for lessons first. If past.dev fails or
  returns nothing, the run uses this file.

## Rules for people

- Process only. No result values, gene lists, scores or anything that shows a task's answers.
- The filter is simple and cannot catch everything. Read the file from time to time.
- You may edit or delete lines. A wrong lesson costs time in later runs.
- Do not edit the `## Task ...` headings. Code uses them to know which task a lesson is from.
