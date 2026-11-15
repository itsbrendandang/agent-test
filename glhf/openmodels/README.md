# openmodels: an open-model grid for BixBench v1, served on Modal

This folder serves open-weight models on Modal GPUs and runs the BixBench v1 adapter
(`../bixbench_v1`) against them. It also holds the plan for the three-model comparison:

| Contestant | Where it runs | Inspect model id | State |
|---|---|---|---|
| Qwen3.6-35B-A3B (FP8) | our own endpoint on a Modal GPU | `openai-api/openmodels/Qwen/Qwen3.6-35B-A3B-FP8` | **waiting**: Modal refuses GPUs until the account has a payment method |
| Claude Opus 5.5 | Anthropic's API, the owner's key | `anthropic/claude-opus-5-5` | prepared, never run |
| OpenAI Sol | OpenAI's API, the owner's key | `openai/gpt-6.1-sol` (an assumption: the newest Sol id) | prepared, never run |

Each contestant runs with both solvers (single agent, three-role swarm) on the same 20 capsules.
The question: which models can do real bioinformatics analysis, at what cost, and does a
checking swarm help a weaker model more than a strong one?

**No benchmark result exists yet.** No open model has been served. Nothing here is a score.

## What is in this folder

| Path | What it is |
|---|---|
| `models.yaml` | The model registry: repo, pinned revision, GPU, price per second, context, tool-call parser, gated or not, status, notes. Also the vendor models with their prices and the source of each price. |
| `apps/qwen36_35b_a3b.py` | The Modal app that serves Qwen with vLLM. One small file. |
| `apps/weights.py` | CPU-only helpers: fetch weights into a Volume; check that vLLM knows our flags. |
| `apps/authcheck.py` | A CPU-only stand-in server, to test the endpoint lock without a GPU. |
| `capsules.json` | The fixed capsule list of the grid, with the seed and the pool it was drawn from. |
| `src/openmodels/` | `registry` (rules for `models.yaml`), `ledger` (cost ledger and cap), `serve` (deploy, stop, key), `checks` (key check, tool-call check, speed), `grid` (the runner), `estimate`, `cli`. |
| `tests/` | 43 tests with fakes. None reaches the network or Modal. |
| `CONTAINERS.md` | Notes on running container benchmarks on Modal Sandboxes. |
| `.secrets/endpoint.json` | The endpoint key. Mode 600. Not in git. Never printed. |

Changes in `../bixbench_v1`: `paid.py` (`refuse_modal`, `isolate_endpoint`), two lines in
`cli.py`, 4 tests in `tests/test_paid.py`, and `tests/test_endpoint_model.py`.

## How a model is served

- vLLM runs inside a Modal `@app.server` class, as in Modal's vLLM example
  (`modal.com/docs/examples/llm_inference`). Weights are cached in the Volume
  `openmodels-hf-cache`. The server runs with the Hugging Face hub offline, so GPU time is
  never spent on a download.
- **The endpoint is locked.** The app does not set `unauthenticated=True`. Modal's proxy then
  asks for a proxy token on every path (`Authorization: Bearer wk-...ws-...`) and answers 401
  without it. A refused request does not start a container. This is the bearer key. Modal
  holds it; we keep a copy in `.secrets/endpoint.json`. It was not put in a Modal Secret,
  because the container never needs it.
- At most one container. None kept warm. It scales to zero after 5 idle minutes. The grid
  runner does not wait for that: it stops the app as soon as a model's runs end.
- Qwen: context 131,072 tokens, 16,384 output tokens by default for one reply, tool-call
  parser `qwen3_coder`, reasoning parser `qwen3` (thinking stays on, as the model ships).
  The agents compact their context at 100,000 tokens, so 131,072 is the length they need.
- GPU choice for Qwen: one **L40S** (48 GB, 1.95 USD an hour; 2.40 with its 4 CPU cores and
  32 GiB of memory). It is the cheapest Modal GPU that should hold the 35 GiB of FP8 weights
  and that context. This is computed from the model's config. It is **not measured**.

## How the harness reaches it

Inspect 0.3.220 has a provider for OpenAI-compatible servers. The model id
`openai-api/openmodels/<repo>` reads `OPENMODELS_BASE_URL` and `OPENMODELS_API_KEY`
(checked in the installed source, `inspect_ai/model/_providers/openai_compatible.py`). The
solvers did not change. `bixbench-v1 run --model openai-api/openmodels/...` works like any
other model, and token counts land in `run.json` the same way
(`../bixbench_v1/tests/test_endpoint_model.py` proves it with a scripted server).

When every model of a run is on our endpoint and `--no-judge` is given, `bixbench-v1 run`
blanks every vendor key. Then the endpoint is the only place the run can reach.

## Commands

Run from `glhf/openmodels/`. Needs [uv](https://docs.astral.sh/uv/), Docker, and the `modal`
command, logged in.

```bash
uv sync
uv run openmodels models        # the registry, checked against the app files
uv run openmodels ledger        # what Modal has cost so far, by our ledger
uv run openmodels estimate      # vendor cells, from the pilot's tokens per question
uv run openmodels status        # our Modal apps that are not stopped (exit status 1 if any)
uv run openmodels stop          # stop all of them. Always allowed.
uv run pytest -q && uv run ruff check .
```

These use Modal, so they are refused unless `NO_PAID_CALLS=0`. Only the person who pays sets it.

```bash
uv run openmodels key                                  # make the endpoint key (done once already)
uv run openmodels weights   --model qwen3.6-35b-a3b    # weights to the Volume, on CPU (done)
uv run openmodels preflight --model qwen3.6-35b-a3b    # does vLLM know our flags? on CPU (done)
uv run openmodels authcheck                            # test the lock on a CPU stand-in (done)

# Needs a GPU. Deploy, key check, tool-call check, speed, stop. Worst case 1.20 USD.
NO_PAID_CALLS=0 uv run openmodels check --model qwen3.6-35b-a3b --name smoke

# Smoke test: ONE small capsule, both solvers. Worst case 4.15 USD; expected under 1 USD.
NO_PAID_CALLS=0 uv run openmodels grid --name smoke --models qwen3.6-35b-a3b \
    --solvers single,swarm --only bix-46_d37acffb

# The grid for Qwen. The cap must be raised: the guard's worst case for 40 runs is 60.28 USD.
NO_PAID_CALLS=0 uv run openmodels grid --name grid1 --models qwen3.6-35b-a3b \
    --solvers single,swarm --capsules capsules.json --cap 80

# The vendor cells. These are paid API calls on the owner's keys. An agent never runs them.
NO_PAID_CALLS=0 uv run openmodels grid --name grid1 --models claude-opus-5-5,gpt-6.1-sol \
    --solvers single,swarm --capsules capsules.json --total-token-cap 12200000

# One judge pass over each finished folder, the same judge for all three (paid: OpenAI).
cd ../bixbench_v1 && NO_PAID_CALLS=0 uv run bixbench-v1 grade --out runs/grid1-qwen3.6-35b-a3b
```

Results go to `../bixbench_v1/runs/<name>-<model>/`, one folder per model with both solvers
in it. That is the layout the results API (`engine/src/bixv1`) and its scoreboard read. The
grid resumes: a run whose `run.json` says `done` is skipped, and a model with nothing left
to do is not deployed at all. `--sandbox modal` passes the adapter's Modal sandbox option
through (see `../bixbench_v1/README.md`); the default is local Docker.

## What a grid session does

For a model on Modal, in this order: check the paid switch; stop and charge any session an
earlier process left open; check the cap; deploy; wait until the server answers; key check;
tool-call check; one `bixbench-v1 run` process for all capsules and solvers; then **always**
`modal app stop`, a check that Modal lists the app as stopped, and the ledger line. The stop
also runs on an error, on Ctrl+C and on a kill signal. A model that fails the key check or
the tool-call check gets no benchmark run. One model is served at a time.

## Cost ledger and cap

- Every Modal session appends one JSON line to `../bixbench_v1/runs/modal_ledger.jsonl` and to
  a copy in the run folder: resource, seconds, where the seconds came from, dollars, rates.
- Seconds are wall-clock, from just before the deploy until after the stop. This is an upper
  bound on the container's time. Modal's own figure: `modal billing report --for today -r h`.
- Dollars = seconds x (GPU + reserved CPU + reserved memory). Prices were read on 2026-11-14
  with `modal billing rates` and are in `models.yaml`.
- Before a session starts, the guard adds its worst case (cold start + every run at its time
  limit + one scaledown window) to the ledger total. If that passes the cap (20 USD; `--cap`),
  the session is refused.
- `NO_PAID_CALLS` covers Modal. With it on (the default) nothing deploys and no request is sent.

Spent so far: 0.04 USD by Modal's own report, all CPU (see `uv run openmodels ledger`).

## The capsule list

`capsules.json`: 20 capsules, **82 questions**. Rule, fixed before the draw: the pool is every
capsule of the question file except the three of the earlier pilot (bix-2, bix-29, bix-46);
`random.Random(20261114).sample(sorted(pool), 20)`. One draw was made and kept. No question
text or answer was used. The draw gave 82 questions, not the 70 that 20 average capsules hold.
Two of the capsules are from bix-61 (large read files; they may need more memory than Docker
Desktop has here) and four are 220 to 230 MB zips.

The smoke test uses bix-46 (2 questions, 1 MB). It was in the pilot, so it is not in the grid.

## Is the comparison fair?

Same for all three models and both solvers: the 20 capsules, the sandbox image, the prompts,
the tools, the time limit (1800 s a run), the token budget (160,000 + 80,000 a question; the
swarm gets the same total), the seed (0), and the grader. Use one sandbox for every cell:
all local Docker, or all Modal. Never mix them.

Where a model cannot honour a setting, or differs:

| Setting | Qwen on Modal | Claude Opus 5.5 | OpenAI Sol |
|---|---|---|---|
| Context | Served with 131,072 tokens (the model allows 262,144). Enough: the agents compact at 100,000. | 1,000,000 | 272,000 |
| Seed | Sent and used by vLLM. | Sent to Inspect. Whether the API uses it was not checked. | Same: not checked. |
| Sampling | No temperature is set, so each model uses its own default. | Its default. | Its default. |
| Thinking | On by default; thinking tokens count as output tokens against the budget. | Whatever the API does when the harness asks for nothing. | Same. |
| Speed | One L40S is slower than a vendor API. More runs may end at the 1800 s limit. Then the result is "same wall-clock", which is harder on the slower server. Report how many runs hit the limit. | | |
| Grading | In the grid, code rules only (`--no-judge`). | Run it with `--no-judge` too. | Same. |

Grade all three the same way: run every cell with `--no-judge`, then one `bixbench-v1 grade`
pass per folder with the same judge. Questions that need the judge stay ungraded until then.
Report tokens and dollars for every cell, and failed runs too.

## Cost of the grid (82 questions, 20 capsules)

**Vendor cells: estimates, not measured on these models.** Basis: the pilot's measured tokens
per question (`../bixbench_v1/runs/pilot-sonnet-5-5`, Claude Sonnet, 8 questions on 3 small
capsules), times 82, at each model's prices. Prices are from the table bundled with the
engine's model library (`engine/node_modules/@earendil-works/pi-ai/dist/providers/data/`,
pi-ai 1.5.2), USD per million tokens.

Pilot tokens per question:

| Solver | fresh input | cache write | cache read | output |
|---|---|---|---|---|
| single | 8 | 4,542 | 33,747 | 1,342 |
| swarm | 14 | 8,109 | 56,036 | 2,390 |

| Cell | Arithmetic (tokens per question x 82 x price / 1,000,000) | Expected | Same tokens with no cache hit | If the whole token budget were spent |
|---|---|---|---|---|
| Opus, single | write 4,542 x 82 x 5 = 1.86; read 33,747 x 82 x 0.2 = 0.55; output 1,342 x 82 x 20 = 2.20 | **4.62 USD** | 14.76 | 39.04 |
| Opus, swarm | write 8,109 x 82 x 5 = 3.32; read 56,036 x 82 x 0.2 = 0.92; output 2,390 x 82 x 20 = 3.92 | **8.17 USD** | 24.96 | 39.04 |
| Sol, single | write 4,542 x 82 x 2.5 = 0.93; read 33,747 x 82 x 0.1 = 0.28; output 1,342 x 82 x 10 = 1.10 | **2.31 USD** | 7.38 | 19.52 |
| Sol, swarm | write 8,109 x 82 x 2.5 = 1.66; read 56,036 x 82 x 0.1 = 0.46; output 2,390 x 82 x 10 = 1.96 | **4.08 USD** | 12.48 | 19.52 |

Fresh input is under one cent in every cell. Prices used: Opus 4 input, 0.2 cache read, 5
cache write, 20 output; Sol 2 input, 0.1 cache read, 2.5 cache write, 10 output. The last column
is the ceiling: the budget of a cell is 20 x 160,000 + 82 x 80,000 = 9,760,000 tokens, priced
as plain input. Inspect stops a run at 1.25 times its budget, which adds a quarter. Expected
total for the four vendor cells: **19.18 USD**. A judge pass is extra.

Why the real cost can differ: the pilot was a different model on three small capsules; Opus
and Sol may think more and write more; the grid has larger capsules; OpenAI caches by its own
rules. The estimate is a guide for the decision, not a quote. `--total-token-cap` is the hard
stop.

**Qwen cells: not measured.** No GPU could be started, so there are no tokens per second and
no seconds per capsule. The cost is seconds x 0.000665 USD. Scenarios, all assumptions:

| Scenario | single, s per question | swarm, s per question | Both cells |
|---|---|---|---|
| As fast as the Sonnet pilot x 3 | 60 | 100 | 8.73 USD |
| Middle | 150 | 255 | 22.09 USD |
| Every run ends at its time limit | (1,860 s a run x 40 runs) | | 49.50 USD |
| What the guard reserves | | | 60.28 USD |

The smoke test (two runs on bix-46) will replace these with a measurement.

## Kimi

Checked on the Hugging Face API without a token, 2026-11-14. Current open-weight releases
under `moonshotai`: **Kimi-K3.1-Pro** (newest, 2026-11-05) and **Kimi-K3**. Neither is gated.

| | Kimi-K3.1-Pro | Kimi-K3 |
|---|---|---|
| Revision | `d9e99b0792a5e93b78ea9bea62a68167e36ddd9e` | `f831ab66814297da540d832a5235f8e904f29d06` |
| Licence | Kimi K3.1 Pro License (its own; not read here) | Kimi K3 License (its own) |
| Parameters | 2.8 trillion, 104 billion active | the same |
| Weights | 1,561 GB. Already quantised by the maker (MXFP4 weights). No smaller official variant was found. | 1,561 GB |
| Context | 1,048,576 tokens | 1,048,576 |
| Tool calls | vLLM: `--tool-call-parser kimi_k3`, needs vLLM 0.34 nightly (vLLM's recipe). SGLang: named on the model card; not checked. | the same parser |

Serving it on Modal: vLLM's recipe asks for 1,874 GB of GPU memory. A B300 has 288 GB, so
that is at least 7 B300: 7 x 7.10 = **49.70 USD an hour** (8 is the most one Modal container
can have: 56.80). That is far over the 10 USD an hour limit, so it was **not deployed**. A
5-hour grid would be about 250 to 285 USD, plus 1,561 GB on a Volume (about 131 USD a month).
Cold start was not measured; loading 1.5 TB takes tens of minutes at best.

Options:

1. **Modal Shared Endpoint** (Modal hosts the model; billed per token). Kimi-K3.1-Pro: 2.00
   input, 0.20 cached, 10.00 output USD per million tokens. With the pilot's tokens: single
   2.40 USD, swarm 4.21 USD, **6.61 USD for both cells** (no cache hits: 19.86). Kimi-K3
   (3.00 / 0.30 / 15.00): 9.92 USD. Modal's docs say plan credit **cannot** pay for Shared
   Endpoints, so this is real money and needs a payment method. It would use the same key
   and the same harness path as Qwen. Not tried.
2. **Moonshot's own API** (`platform.kimi.ai`). Needs a key from the owner. Then Kimi is an
   API contestant like Opus and Sol. Its prices were not looked up.
3. An older, smaller Kimi: K2.6 is 1.03 trillion parameters, 595 GB. Still 3 B300 or more
   (21.30 USD an hour). Not a current model.

## How to shut everything down

```bash
uv run openmodels stop                 # stops every app of ours; prints what is still live
modal app list                         # nothing named openmodels-* may be "deployed"
modal volume delete openmodels-hf-cache    # the weights: 37.5 GB, about 3.15 USD a month
modal volume delete openmodels-vllm-cache  # empty
modal workspace proxy-tokens list      # then: modal workspace proxy-tokens delete <token id>
```

A stopped app costs nothing. The Volumes cost storage until they are deleted.

## Limits and what is not verified

- **No model was served.** Modal answers "Please add a payment method to use L40S GPU
  functions" for every GPU type. So: no real tool-call request, no tokens per second, no
  smoke test, no measured cost. The tool-call check exists and is tested with a fake only.
- That Qwen fits one L40S with a 131,072 context is computed, not measured.
- The vLLM flags were checked against vLLM's source on CPU, not by starting the server.
- The lock was tested on a CPU stand-in with the same `@app.server` settings, not on the
  model's own app: 8 paths answered 401 without the key and with a wrong key, 200 with it.
- Inspect builds a model object for `anthropic/claude-opus-5-5` and `openai/gpt-6.1-sol`
  without a request. Inspect 0.3.220 has no entry for either id, so it treats them as generic
  models of their vendor. Whether each API accepts every parameter the harness sends (the
  seed, for one) is known only after a first call. Start the vendor run with one capsule.
- An unauthenticated request cannot wake a GPU. A request with a valid key can, so keep the
  key private. While an app is deployed and idle it costs nothing.
- Requests are sent one at a time. A GPU could serve several runs at once for almost the same
  price; the harness has no `--jobs` option yet. That is the largest saving left.
