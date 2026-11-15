# Showing concurrent board runs: what runs where, and the data to draw it

For the UI team. You want one sprite per role that multiplies when the same role works in several
runs at once on Modal. This file says what really runs at once, which data shows it, and what must
still be built to get that data into the dashboard.

The dashboard and engine files named here are those on `main` (2026-11-15).

## 1. What runs at once: runs, not roles

The BixBench board harness (`glhf/bixbench_board/`) solves one study at a time per **run**. A run is
one study and one repeat, named `<study_id>/rep<k>`, for example `bix-3/rep1`. Each run is a whole
board: every member takes part in it.

`run.py --workers N` runs up to N runs at the same time. So with N runs going, there are N of
**every** member at once, not N of one role.

```
the VM (run.py, one process)                          Modal
--------------------------------------------          ---------------------------------
run bix-1/rep0: proposer, experimenter, ...  ──cells──▶  sandbox for bix-1/rep0
run bix-1/rep1: proposer, experimenter, ...  ──cells──▶  sandbox for bix-1/rep1
run bix-2/rep0: proposer, experimenter, ...  ──cells──▶  sandbox for bix-2/rep0
   ... up to --workers runs at once
```

- Every member's **model calls** run on the VM. They go from the VM to the model's provider.
- Only the **experimenter's code cells** (`run_code`, and its `list_dir` and `read_file`) run on
  Modal, in the sandbox of its own run. One run has one sandbox. Other members never run on Modal.
- With `--sandbox local` (the default) the cells run on the VM. Everything else is the same.
- Inside one run, members can also work at the same time. Today the methods auditor and the critic
  review together. In the 7-member board that is being built (PR #20), members answer in parallel
  each round. So one run can have two or more members active at once, and the experimenter can run
  cells while others talk.

## 2. What to draw

- **A sprite instance is one member in one run:** (run id, member). A role's group has one
  instance for each run that is going now. This is the "multiplying" you want.
- **Active or waiting.** Inside a run, a member is *active* while it has a turn (section 4.3).
  Draw the others of that run as present but idle.
- **The Modal badge** belongs on the **experimenter** instance, and only while one of its cells
  runs on Modal (`where` is `modal`). Do not put other roles "on Modal".
- **Who is on the board:** read `run_start.members`. Never hard-code 5, 7 or 8: the board is
  changing from 5 to 7 members now, and a teammate may add an eighth. An unknown name gets the
  neutral face (`agentIdentity` in `dashboard/src/lab/identity.ts`).
- **Faces:** `agentIdentity(member, { mode })`. The experimenter's `mode` in the transcript is
  `full` or `revise`, and `identity.ts` already maps `revise` to the reviser's face.
- **The instance's identity comes from the run id**, never from the name. `identity.ts` removes a
  trailing number on purpose (`audit 2` is the auditor), so `experimenter 3` would not make a third
  experimenter.

## 3. Status today: nothing is live yet

- The Modal sandbox for board runs is on the branch `board-cell-timeout`, on top of PR #20. It is
  tested with a fake Modal only. **No run has used real Modal yet.**
- PR #20 is the 5-member board. It is being changed to the 7 members of the app.
- The engine reads nothing from board-harness runs, and the dashboard has no view for them
  (section 5).
- So a demo today must be a **replay**: a recorded or scripted run played back, as
  `dashboard/src/lab/preview/Preview.tsx` does with `dashboard/src/lab/fixtures/`. Say on screen
  that it is a replay. A scripted run is not a benchmark result (AGENTS.md).

## 4. The data: the run's transcript

### 4.1 Where it is

```
<out>/                                   for example glhf/bixbench_board/runs/board_gpt51/
  <study_id>/rep<k>/transcript.jsonl     live, one event per line
  <study_id>/rep<k>/work/cell_NNN.py|.R  live, written as each cell starts
  <study_id>/rep<k>/result.json          at the end of the run (holds answers to never serve, see 6)
  modal_ledger.jsonl                     one line per Modal sandbox, written when it closes
  runs.json                              at the end of the whole command
```

`transcript.jsonl` is written line by line and flushed at once, so you can follow it while the run
goes on. Every line has `t` (Unix time in seconds) and `event`. Lines from members that work at the
same time never mix.

### 4.2 The events

| `event` | When | Fields you need |
|---|---|---|
| `run_start` | the run begins | `run` (the run id), `study_id`, `solver` (`board` or `single`), `members` (list), `sandbox` (`{"sandbox": "local"\|"modal", ...}`; on Modal also `sandbox_id`, `image`, `environment_check`), `model` |
| `member_input` | a member's turn starts | `member`; the experimenter also has `mode` (`full` or `revise`) |
| `member_output` | one model call of that member ends | `member`, `budget` (see 4.4) |
| `tool_call` | a tool starts (experimenter; single agent) | `member`, `name` (`run_code`, `list_dir`, `read_file`, `record_draft`), `id` |
| `cell` | a code cell ended | `member`, `id` (same as its `tool_call`), `cell` (number), `language` (`python`\|`r`), `where` (`local`\|`modal`), `exit_code`, `timed_out`, `duration_s`, `new_files` |
| `tool_result` | the tool's answer went back to the model | `member`, `id`, `name` |
| `final_answer` | answers are fixed | `forced` |
| `run_end` | the run is solved (grading may still run) | `phases`, `stop_reason`, `error`, `budget` |

The single-agent solver (`solver: "single"`) writes `message` events instead of `member_input` and
`member_output`, and its only member is `agent`.

### 4.3 How to tell each state

| State | What shows it |
|---|---|
| Starting (data, a Modal sandbox, or waiting for the Modal cap) | the run folder exists, with no `transcript.jsonl` yet |
| Running | `run_start`, no `run_end` |
| A member is active (proposer, critic, auditor, reporter) | between its `member_input` and its `member_output` |
| The experimenter is active | from its `member_input` (mode `full` or `revise`) until another member's `member_input`, or `run_end`. It makes many model calls: one `member_output` each |
| A cell is running | between a `tool_call` with `name: "run_code"` and the `cell` with the same `id`. `where` tells local or Modal. A cell lasts at most 120 seconds |
| Solved | `run_end` |
| Graded and done | `result.json` exists |
| Failed | `run_end.error` is set, or the run is listed in `runs.json` `failures` |
| Stopped or stalled | no new line for longer than the run's time (`--budget-seconds`) plus 15 minutes. Ctrl+C ends every Modal sandbox at once, and the runs stop soon after |

A run's Modal sandbox opens before `run_start` and closes after `run_end`. Its line in
`modal_ledger.jsonl` (seconds, dollars, `ok`) is written only when it closes.

### 4.4 Progress

`member_output.budget` and `run_end.budget` hold `caps` and `used` (`total_tokens`, `tool_calls`,
`model_calls`) and `elapsed_seconds`. Progress is `used / caps`. All members of a run share one
budget.

## 5. Connections still to build (your part)

**Engine: read the runs.** Nothing reads them today. Copy the pattern of
`engine/src/bixv1/store.ts`:
- read-only, and never throws: problems go in an `error` field;
- only folder names that pass `isSafeId` (`engine/src/http.ts`), a fixed depth, no symlinks;
- the root folder from a variable (as `BIXV1_RUNS_DIR` does), so tests use fixture folders;
- a cache keyed on file times and sizes.

**Engine: one live stream for the whole set of runs.** Reuse `sse()` in `engine/src/app.ts`: it
sends a file and then follows it with `fs.watch`. Send **one** stream for a `<out>` folder, with each
event tagged by its `run`. One stream per run will not work: the engine allows at most
`MAX_STREAMS = 32` streams in all and 8 per run, and a set can have 40 runs at once.

**Dashboard: instances.** `LabModel.characters` in `dashboard/src/lab/model.ts` holds exactly one
sprite per role, and the app's board review depends on that. Add instances beside it (for example a
list of `{ run, member, active, cell }`) instead of changing it. Draw them with `AgentAvatar`
(`dashboard/src/lab/AgentAvatar.tsx`). Live events reach the lab through `useLabEvents` in
`dashboard/src/lab/useLabModel.ts`, which drops repeated events by key.

**Types.** Add new types. Do not rename the ones in `engine/src/glhf/types.ts`: the dashboard is built
against them (AGENTS.md).

## 6. Never

- Never serve `result.json` as it is: it holds each question's `ideal` answer and the grades. Serve
  only status fields. The same holds for `grade.json` and the question file (AGENTS.md: no ideal
  answer in any default response).
- Never send a `POST` to the engine on `127.0.0.1:8787`: it may be someone's live engine with real
  keys. Test with your own engine on another port (AGENTS.md shows how).
- On the benchmark, the scout has no web search. Do not draw it searching the web.

## 7. Cases to plan for

- Runs start and end at different times, and repeats of one study run at the same time
  (`bix-3/rep0` and `bix-3/rep1`).
- A run that waits for the Modal cap shows no transcript for a while.
- A member waiting on the provider's rate limit looks stalled: it has a `member_input` and no
  `member_output` for a long time.
- A cell that runs past 120 seconds is stopped: its `cell` event has `timed_out: true`.
- `--workers` decides how many instances of each role you can see at once. Size the layout for 40.
