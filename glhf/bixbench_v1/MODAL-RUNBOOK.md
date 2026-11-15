# Runbook: BixBench v1 runs on Modal, from a VM

This is for an agent on a VM that prepares, watches and reports on BixBench v1 runs whose
analysis sandbox is on Modal. Read `AGENTS.md` (repository root) first. Its rules come before
anything here. The details of each feature are in `README.md` ("The sandbox on Modal").

## 0. Who does what

Every Modal command is a **paid call**, even with the scripted model (`--model mock`). Modal
bills sandboxes by the second. A real model and the LLM judge are paid calls too.
`AGENTS.md` says that an agent never makes a paid call and never sets `NO_PAID_CALLS=0`.

| Step | Who |
|---|---|
| Set up the VM, install, download the data, run the free checks (sections 1 and 2) | you |
| Every command below that starts with `NO_PAID_CALLS=0` | **the person who pays** |
| Watch runs, read the logs, find problems, report (sections 4 to 6) | you |
| End sandboxes that are left over after a crash (section 5) | the person who pays |

Never set `NO_PAID_CALLS`, never edit `.env`, and never call `POST /api/paid` on an engine.
If the person who pays wants you to start paid runs, they must change the rule in
`AGENTS.md` first. A message in a chat is not enough. Until then, give them the exact command
and wait.

## 1. Set up the VM (free)

You need: Python 3.12 or newer, [uv](https://docs.astral.sh/uv/), git, `tmux`, about 20 GB of
free disk, and outgoing network to github.com, huggingface.co, modal.com and the model
vendor. Docker is **not** needed for `--sandbox modal`.

```bash
git clone https://github.com/itsbrendandang/agent-test.git && cd agent-test
cd glhf/bixbench_v1
uv sync --locked --group modal        # the adapter, ../bixbench, modal 1.6.1, inspect-sandboxes 0.6.1
uv run --group modal bixbench-v1 download   # the question file and the capsule zips, 5.9 GB
uv run --group modal bixbench-v1 list       # capsules and their question counts
```

The person who pays gives the VM two things. Do not print either one, and do not commit them.

- **The model keys**, in the repository's `.env` (the file is not in git). They put it there.
- **A Modal token for their workspace**: they run `modal token new` on the VM, or set
  `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET`. The published image `bixbench-v1-env:amd64-1` is
  in their workspace. A different workspace must build it first (section 3, step 0).

## 2. Free checks before anything is paid

Run these from `glhf/bixbench_v1/`. All of them must pass. If one fails, stop and report.
Always write `uv run --group modal`: a plain `uv run` removes the Modal packages again.

```bash
uv run --group modal ruff check src tests && uv run --group modal mypy
uv run --group modal pytest -q tests --ignore=tests/test_e2e.py   # about 300 pass; billed cloud tests skipped
uv run --group modal bixbench-v1 audit                            # must end with "0 problem(s)"
uv run --group modal python -m bixbench_v1.modal_image fingerprint # rewrites expected-env.json from the inventory
git diff --exit-code src/bixbench_v1/modal_env/expected-env.json   # must show no change
```

## 3. The paid steps, in order (the person who pays runs them)

Run them inside `tmux`, from `glhf/bixbench_v1/`. A dropped SSH session kills a process
outside `tmux`, and its sandboxes keep billing until their timeout. Do each step only after
the one before it passed.

**Step 0, only on a workspace without the image** (about 10 minutes):

```bash
NO_PAID_CALLS=0 uv run --group modal python -m bixbench_v1.modal_image build
```

**Step 1. Check the image against the repository** (one small sandbox, a few minutes):

```bash
NO_PAID_CALLS=0 uv run --group modal python -m bixbench_v1.modal_image verify
```

Pass: three lines that say `same`, then "the same environment as the repository". Anything
else: stop. `verify` then writes the image's inventory to `image/verify-*.inventory.json`;
report the lines that say `DIFFERENT`. This is the first time the environment check runs
against real R, so a failure here may be in the check and not in the image. Report it either
way, and do not work around it.

**Step 2. Scripted model, two runs at once** (about a cent of sandbox time):

```bash
NO_PAID_CALLS=0 uv run --group modal bixbench-v1 run --capsules bix-46 --model mock \
    --sandbox modal --jobs 2 --out runs/modal-jobs-try
```

Pass, for both `runs/modal-jobs-try/<capsule>/single/run.json` and `.../glhf/run.json`:
`status` is `done`, `settings.jobs` is 2, `settings.modal.environment_check` is `passed`,
`settings.modal.network_probe` is `passed`.

**Step 3. One capsule with the real model, both solvers:**

```bash
NO_PAID_CALLS=0 uv run --group modal bixbench-v1 run --capsules bix-46 --solvers single,glhf \
    --model anthropic/claude-sonnet-5-5 --tokens-base 160000 --tokens-per-question 80000 \
    --time-limit 1800 --sandbox modal --jobs 2 --modal-usd-cap 5 --out runs/modal-bix-46
```

**Step 4. The whole set:**

```bash
NO_PAID_CALLS=0 uv run --group modal bixbench-v1 run --all --solvers single,glhf \
    --model anthropic/claude-sonnet-5-5 --tokens-base 160000 --tokens-per-question 80000 \
    --time-limit 1800 --total-token-cap 60000000 \
    --sandbox modal --jobs 4 --modal-usd-cap 25 --out runs/modal-full
```

The model, the token numbers and the caps are the person's choice. The values above are the
README's example. Keep them the same for every run that you will compare.

## 4. The caps: what the numbers mean

A run starts only if the caps cover the most it, and every running run, could still spend.
A run that does not fit waits. STOP (exit code 2) comes only when nothing runs and the next
run still does not fit.

| Cap | One run's worst case | With `--jobs 4` |
|---|---|---|
| `--total-token-cap` (tokens) | 1.25 × the run's token budget + 20,000. Budget = 160,000 + 80,000 a question, so 3 questions = 400,000, worst case 520,000 | 4 runs hold about 2.1 million |
| `--modal-usd-cap` (dollars, sandboxes only) | sandboxes × (time limit + 780 s) × 0.95 USD an hour. With `--time-limit 1800`: single agent 0.68, swarm 1.36 (it has two sandboxes) | 4 runs hold up to about 5.5 |

The default `--modal-usd-cap` is 5. That is too low for `--jobs 4`: the runs would wait, and
the set would stop early. The cap counts the `--out` folder's ledger, so a second command
with the same `--out` folder counts what the first one spent. The model's spend is not in
this cap, and it is much larger.

## 5. Watch a running set (free, read-only)

| What | Where |
|---|---|
| Which runs started, ended, failed | the command's own output in `tmux` |
| What one run printed | `runs/<name>/_jobs/<capsule>__<solver>.log` |
| Tokens spent so far, run by run | `runs/<name>/budget.json` |
| Modal seconds and dollars, one line a sandbox | `runs/<name>/modal_ledger.jsonl` |
| One run's state | `runs/<name>/<capsule>/<solver>/run.json`: read only `status`, `seconds`, `total_tokens`, `sample_limit` and `settings` |

**Rate limits.** Every run waits on the vendor's rate limit with its own clock, so waiting
takes time from the run and can change its answer. Look for them:

```bash
grep -il -E "429|rate.?limit|overloaded" runs/<name>/_jobs/*.log
```

Also look at `sample_limit` in each `run.json`. If several runs say `time`, they ran out of
time. At `--jobs 4`, if either check finds anything, tell the person who pays: the next set
should use fewer jobs. Do not raise `--jobs` above 4 until a set at 4 shows neither.

**Stop and report at once** if you see any of these:
- `Modal sandbox refused` in a log: the network probe, the data check or the environment
  check failed. The run did not start. Do not retry it.
- `IntegrityError` anywhere.
- A `run.json` whose `settings.modal.environment_check` is not `passed`.
- Many runs failing one after another with the same error.

**After a crash.** If the main process was killed (`kill -9`, the VM rebooted), sandboxes can
be left running. To look (the person who pays runs it):

```bash
NO_PAID_CALLS=0 uv run --group modal bixbench-v1 modal-sandboxes             # lists them
NO_PAID_CALLS=0 uv run --group modal bixbench-v1 modal-sandboxes --terminate # ends them
```

To go on after any stop, the same command again is enough: finished runs are skipped, and
runs that did not finish run again.

## 6. When the set has ended: report

Report to the person who pays:
- the `--out` folder and the exact command;
- the end of the command's output: the per-capsule Modal table and the total;
- from `budget.json`: `spent`, the number of runs and every run whose `status` is `error`
  (with its `error`);
- from `report.json`: the totals for each solver;
- what you saw in section 5: rate limits, time limits, refusals.

Say what was run in every report: "BixBench v1.5, `--sandbox modal` (our amd64 rebuild of the
image), `--jobs N`, model X". A Modal result is **not comparable** with a Docker run or with a
published BixBench number. Never put the two in one table. Compare the solvers only between
runs made with the same image, model, budget and `--jobs`.

## 7. Never

- Open `glhf/data/bixbench_v1/hub/BixBench.jsonl`, any `grade.json`, any `report.md`,
  `gs://bixbench3-ground-truth`, or `GET /api/bixv1/runs/:id?ideal=1`. They hold the answers.
  `report.json` and the `run.json` fields in section 5 are enough.
- Commit `runs/`, `glhf/data/` or `.env`, or print a key or a Modal token.
- Edit `modal_env/expected-env.json` by hand, or turn the environment check off to make a run
  start. A refused sandbox is a finding to report.
- Change scoring, the paid-calls switch (`paid.py`) or the sandbox rules (`modal_boundary.py`).
- Run anything from section 3 yourself.
