# Containers on Modal: notes

Status: notes only. Nothing in this file was run by the agent that wrote it, except where a
line says "measured". Lines marked **(not verified)** were not checked.

## 1. Our own sandbox on Modal

The work is in `../bixbench_v1`: the option `bixbench-v1 run --sandbox modal` (files
`src/bixbench_v1/modal_sandbox.py`, `modal_image.py`, `modal_stage.py`; an x86 image built to
match the official one). Read the Modal section of `../bixbench_v1/README.md` for what it is,
what was tested and what it costs. The earlier plan is `docs/proposals/modal.md`.

The grid runner here passes the option through: `uv run openmodels grid ... --sandbox modal`.
Use one sandbox for every cell of a comparison.

Two findings from that work, reported by its author (measured there, not here):

- Modal Sandboxes run under gVisor. There is no `/proc/sysvipc` and no `/dev/mqueue`, and
  `ipcrm -a` removes nothing. A System V shared-memory segment or message that one Unix user
  wrote stays readable by another user after the adapter's blind sweep. So one sandbox cannot
  be shown to keep the critic blind there. Two sandboxes can: the critic gets a fresh one.
- Going past the memory limit ends the whole sandbox, not only the process.

## 2. What stops BixBench itself from running there

The official image, `futurehouse/bixbench:aviary-notebook-env`, is published for linux/arm64
only (`docker manifest inspect`, recorded in `docs/proposals/modal.md`). Modal runs
linux/amd64 only. So the image cannot be imported; it must be rebuilt for x86, and a rebuilt
image is a different environment. Scores from it are not comparable with published BixBench
numbers or with our local pilot. A comparison of our own models is still fair if every cell
uses the same image.

## 3. Harbor: container benchmarks on Modal Sandboxes

Modal's example `harbor_evals` (`modal.com/docs/examples/harbor_evals`, read 2026-11-14) uses
the Harbor framework (`harbor[modal]==0.15.0`). What the example shows:

- A Harbor task is a folder: `task.toml` (Docker image, CPUs, memory, storage, network mode),
  `instruction.md`, `solution/solve.sh`, `tests/test.sh`. The test writes a reward (0 or 1)
  to `/logs/verifier/reward.txt`.
- `harbor run --path <task> --agent <agent> --env modal --n-attempts N --n-concurrent N`
  runs each attempt in its own Modal Sandbox. The example runs 8 at once with the `oracle`
  agent (it runs the reference solution) on a toy task with `network_mode = "no-network"`.
- It needs a Modal login (`~/.modal.toml` or `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET`).

How this could serve us: a benchmark that already ships Harbor tasks needs no sandbox code
from us. We would write one Harbor agent that wraps our solver (single agent or swarm), or use
Harbor's built-in agents with a model on our endpoint. **(not verified)**: how a custom agent
is written, and whether a Harbor agent can call an OpenAI-compatible endpoint with our key.

### Benchmarks in Harbor's registry that fit science or data analysis

Read from Harbor's public registry file on 2026-11-14
(`raw.githubusercontent.com/laude-institute/harbor/main/registry.json`, 75 datasets). Task
counts and descriptions are the registry's own. Whether each task image builds for x86
was **not verified**, except BixBench (below).

| Dataset | Tasks | What it is (the registry's words, shortened) |
|---|---|---|
| `replicationbench` | 90 | Reproducing computational results from astrophysics research papers. |
| `dabstep` | 450 | Multi-step data analysis: payment data, Python and pandas, business questions. |
| `ds-1000` | 1,000 | Data science code problems across seven Python libraries. |
| `spreadsheetbench-verified` | 400 | Real spreadsheet manipulation tasks on Excel files. |
| `researchcodebench` | 212 | Implementing algorithms from academic papers. |
| `mlgym-bench` | 12 | ML tasks: vision, reinforcement learning, tabular, game theory. |
| `ml-dev-bench` | 33 | ML development: implementation, training, debugging. |
| `labbench` | 181 | LAB-Bench FigQA: reasoning about biology figures (not an analysis sandbox task). |
| `bixbench`, `bixbench-cli` | 205 each | BixBench v1.5 as Harbor tasks, one task per question. |

BixBench in Harbor hits the same wall. Its task Dockerfile starts
`FROM futurehouse/bixbench:aviary-notebook-env` (read from
`laude-institute/harbor-datasets`, `datasets/bixbench/bix-1-q1/environment/Dockerfile`), the
arm64-only image. Its `task.toml` asks for 2 CPUs, 8 GB of memory, 20 GB of storage, a 3,600 s
agent limit, and a verifier that calls `gpt-4o` with an OpenAI key (a paid judge). So on Modal
it would need the same x86 rebuild. **(not verified)**: whether it builds or runs on Modal;
we did not try.

The closest fit to our project is `replicationbench` (reproduce a paper's computed result),
then `dabstep` (many cheap analysis questions with exact answers).

### Rough cost

Sandbox prices from `modal billing rates`, 2026-11-14: 0.1419 USD per core-hour and 0.024 USD
per GiB-hour. The model's cost is separate and is usually the larger part.

| Case | Sandbox size | Assumed time per task | Sandbox cost |
|---|---|---|---|
| One BixBench task as Harbor sizes it | 2 cores, 8 GiB: 0.476 USD an hour | 10 minutes | 0.08 USD |
| BixBench in Harbor, 205 tasks | the same | 10 minutes each | about 16 USD |
| `dabstep`, 450 tasks | 1 core, 2 GiB: 0.19 USD an hour **(size assumed)** | 5 minutes each | about 7 USD |
| `replicationbench`, 90 tasks | 4 cores, 16 GiB: 0.95 USD an hour **(size assumed)** | 60 minutes each | about 86 USD |

Every time in this table is an assumption. Task sizes other than BixBench's were not read.
Some replication tasks may need a GPU; that was not checked. Image builds and Volume storage
are extra.

### Before any of this is run

- Check the licence of each dataset and whether its answers may be published.
- Check each task's network mode. Our BixBench runs keep the network off.
- Check the answer boundary: a Harbor task carries its solution and tests in the task folder.
  Confirm they are not in the agent's sandbox **(not verified)**.
- A GPU on Modal needs a payment method on the account. Sandboxes on CPU do not.
