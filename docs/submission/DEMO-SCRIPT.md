# Demo script: 3 minutes, scripted model only

This demo calls no paid service. Every run uses `--model mock`, the scripted model. It replays
fixed steps. **It shows that the code works. It shows nothing about science.** Say so on stage.

Rehearsed on 14 Nov 2026 on macOS (Apple Silicon), working tree with uncommitted changes (HEAD between `f6aee6d` and `77f7b75`).
Steps 0 to 5 were run as written. Step 6 (dashboard) was **not** rehearsed; it is optional.

## Before you go on (5 minutes, off stage)

Two terminals, T1 and T2, both in the repository root. Large font.

```bash
# T1 and T2
export NO_PAID_CALLS=1          # the engine then refuses every paid call (engine/src/paid.ts)
```

```bash
# T1
npm run doctor                  # must end with "Ready for local runs"
npm run demo                    # must end with "score 1.000". Also warms the Docker image.
lsof -iTCP:8787 -sTCP:LISTEN    # must print nothing: the engine must NOT be running for step 2
cd glhf/bixbench && uv run python ../../docs/submission/demo/ledger_refusal.py && cd ../..
```

```bash
# T2: go to the harness folder and stay there
cd glhf/bixbench
```

Why the engine must be off: with the engine running, the CLI only follows the run. Killing the
CLI would then kill nothing that matters.

If `npm run demo` fails off stage, do not do the live run. Use the fallback in each step.

Keep `glhf/bixbench_v1/runs/pilot-sonnet-5-5/report.md` open in an editor tab. It is a local
file (not in git). If your machine does not have it, read the numbers from
[WRITEUP.md](WRITEUP.md).

## Timeline

| Time | Step |
|---|---|
| 0:00 | 0. The real result |
| 0:20 | 1. Doctor |
| 0:35 | 2. Start a pair, kill the tracker, resume |
| 1:15 | 3. The ledger refuses (while step 2 finishes) |
| 1:40 | 4. Findings and scoreboard |
| 2:15 | 5. Memory gate |
| 2:35 | Close: two failure modes |
| 3:00 | End |

## Step 0. The real result (0:00)

T1:

```bash
head -8 glhf/bixbench_v1/runs/pilot-sonnet-5-5/report.md
```

The audience sees two rows: `glhf 4/8 ... 532,394` tokens and `single 4/8 ... 317,110` tokens.

Say: "Our only benchmark result with a real model is this. Eight questions. The swarm tied the
single agent, four to four, and used about 1.7 times the tokens. That is not a win. Everything
you see next uses a scripted model. It shows our plumbing, not science."

If it fails (no file): show the table at the top of `docs/submission/WRITEUP.md` and say the
same words.

## Step 1. Doctor (0:20)

T1:

```bash
npm run doctor
```

The audience sees `MISSING gcloud CLI`, `MISSING GCP project`, `MISSING Hugging Face access`,
then `Paid calls: OFF`, then `Not ready for BixBench3 cloud runs`.

Say: "Nothing has run in the cloud. The gated BixBench3 benchmark has never been run. The tool
says so itself."

If it fails: skip. Say the two sentences anyway.

## Step 2. Start a pair, kill the tracker, resume (0:35)

T1:

```bash
npm run glhf -- run --mode local --solvers glhf,single --model mock --memory --follow
```

The audience sees `started ...-demo-glhf, ...-demo-single (tracked by this command; the engine
is not running)`, then `launching`, then `running: running` (after about 5 seconds).

Say: "One request starts the swarm and the single agent with the same settings, one after the
other. Now the tracker crashes."

As soon as you see `running: running`, in T2:

```bash
pkill -9 -f "glhf/cli.ts run"
```

T1 shows `Killed: 9`. Then in T1:

```bash
npm run glhf -- list
npm run glhf -- resume
```

`list` shows the swarm run as `running`, the single-agent run as `queued`, and the line
`Unfinished runs are not being tracked right now`. `resume` prints `Continuing 2 run(s)` and
follows them. It needs about 25 seconds. Do step 3 while it runs.

Say: "The run state is in a durable store, built on Pi Durable. The sandbox kept working. The
tracker picks the run up, does not start it a second time, and then starts the partner."

If it fails:

- `could not start: a local run is still going`: an older run is open. Run
  `npm run glhf -- list`, then `npm run glhf -- cancel <run-id>`, and start again. If you have
  no time, go to step 3 and use the run from the warm-up for step 4.
- `pkill` kills nothing (the run already ended): say "it finished before I could kill it" and
  go on. Do not retry.
- `resume` hangs for more than 40 seconds: press Ctrl-C and go on. Use the warm-up run for
  step 4. Say that the live run did not finish.
- Docker error: skip to step 3. It needs no Docker.

## Step 3. The ledger refuses (1:15)

T2 (already in `glhf/bixbench`):

```bash
uv run python ../../docs/submission/demo/ledger_refusal.py
```

The audience sees, in under a second:

```
Step 1. The critic reports a good result for a test it never registered:
  REFUSED by code: C1 has no registered test named 'my best test'; ...
Step 2. The critic registers two tests, then reports only the one that came out well:
  verdict: insufficient  (waiting for: held-out)
Step 3. The second registered test gets its result:
  verdict: supported  (mean e-value 50, needed 10)
```

Say: "No model decides a verdict. A test must be registered before its result. A good result
that was not registered is refused. A registered test with no result blocks support. Under
these rules, and if the reported p-values are honest, at most one run in ten marks a false
claim as supported. Code cannot check the p-values themselves. No real-model run has used these
rules yet."

If it fails: run `uv run pytest -q tests/unit/test_glhf_ledger.py` (13 seconds, 35 tests) and
say the same words. If that fails too, open
`glhf/bixbench/src/bixbench3/inspect_harness/swarm/ledger.py` and show the top comment.

## Step 4. Findings and scoreboard (1:40)

T1 (the resume has ended; the last lines show both runs `done`, `score 1.000`, and the label
`[scripted model: shows the plumbing works, not the science]`):

```bash
head -20 "glhf/runs/$(ls -t glhf/runs | grep -- '-demo-glhf' | head -1)/outputs/glhf/FINDINGS.md"
npm run scoreboard
```

The audience sees `FINDINGS.md`: the guarantee and its limits in the second paragraph, then
`Supported findings (1)` with claim C1 (mean e-value 25, threshold 20) and `Rejected claims (1)`
with claim C2. Then the scoreboard: one row, `demo  1.000  1.000  +0.000`, and the note
`settings that differ. swarm only: memory, 3 review rounds`.

Say: "Code wrote this file, not a model. It states its own limits in every run. The scoreboard
shows a difference only when task, model, time limit and token budget match. It names what only
the swarm had. These two scores of 1.0 are scripted. They mean nothing about science."

If it fails: run `npm run glhf -- list`, then `npm run glhf -- show <run-id>` on any run that is
`done`. It prints the claims and their verdicts.

## Step 5. Memory gate (2:15)

T2:

```bash
uv run python -m bixbench3.inspect_harness.swarm.memory \
  --dir "../runs/$(ls -t ../runs | grep -- '-demo-glhf' | head -1)/memory" list
ls "../runs/$(ls -t ../runs | grep -- '-demo-glhf' | head -1)/memory"
```

The audience sees `1 pending` with one lesson line, and a folder that holds only
`lessons.pending.md`. A Python `RuntimeWarning` about `sys.modules` may appear. Ignore it.

Say: "The run wrote a lesson. It is only queued. No later run reads it, and nothing goes to
past.dev, until a person approves it. There is no approved file here."

Do not run `approve` on stage. With a `PAST_API_KEY` in `.env` it sends the lesson to past.dev.
(We did not rehearse `approve`.)

If it fails (`0 pending` or no folder): the run in step 2 did not finish or was started without
`--memory`. Say the three sentences and show `glhf/memory/README.md`.

## Close: two failure modes (2:35)

Show the open editor tab with `report.md`, the per-question table at the bottom.

Say: "Back to the real pilot. Two things went wrong, and they are ours. One: on capsule bix-2
each role got 42% of the budget, which was less than one analysis needs. The analyst was cut
off with no answer. Two: on capsule bix-29 the swarm marked four answers as replicated, and all
four were wrong. The critic had seen a hint from the analyst and made the same choice. We
changed the budget rule and made the critic blind. Those changes pass tests with the scripted
model. They have not been run with a real model. We do not know if they help. With a budget we
would run all 205 questions and report the difference, whatever it is."

## Step 6. Optional: dashboard (not rehearsed)

Only if you have spare time and checked it off stage. We did not click through this.

Before the demo, in a third terminal: `npm run dashboard` (port 5317). After step 4, in T1:
`npm run engine` (port 8787; first lines show `mock models` and `Paid calls: OFF`).

1. Open `http://localhost:5317`. The Swarm view is the first view.
2. Look at the card "Scoreboard: single agent against swarm". It should show the pair from
   step 2.
3. Scroll to "Claims" and "Findings and rejections" for the latest swarm run.

Do not press **New run** on stage. The labels above were read from
`dashboard/src/views/SwarmView.tsx`, not checked in a browser.

If anything looks wrong: close the tab and go to the close.

## After the demo

```bash
docker ps        # no container named inspect-bixbench3_... should be left; stop any that are
```

## Notes for whoever rehearses

- Measured times on a busy machine: `npm run demo` 23 to 46 seconds (the README says about 15).
  Kill at about 9 seconds. `resume` 24 to 29 seconds for both runs.
- The rehearsal used a throwaway run folder and port (`GLHF_RUNS_DIR=/tmp/...`,
  `DRUG_BOARD_PORT=18931`), because other engines were running on this machine. The commands
  were otherwise the same. Step 4 and step 5 paths with `glhf/runs` were checked with that
  folder in their place.
- `pkill -9 -f "glhf/cli.ts run"` kills every process that matches. In the rehearsal the match
  was checked with `pgrep -f` and the process was killed with `kill -9 <pid>`.
- The scripted swarm run always makes the same two claims: C1 supported, C2 refuted, and one
  issue that the Reviser fixes.
