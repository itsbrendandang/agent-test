# Local model (Qwen on Ollama)

A local model is the third kind of model in this repo.

| Kind | Example id | Calls a model? | Costs money? | Leaves this machine? | Allowed while `NO_PAID_CALLS` is on? |
| --- | --- | --- | --- | --- | --- |
| Scripted | `mock` | no, it replays a script | no | no | yes |
| **Local** | `ollama/qwen2.5:14b` | yes, a real model | no | no | **yes** |
| Paid | `anthropic/claude-sonnet-5-5` | yes | yes | yes | no |

A local model is real: its answers are not scripted and they can be wrong. It is also much weaker than a paid
frontier model. Read [What to expect](#what-to-expect) before you use a local score for anything.

## The definition

A model is local when both of these are true. The same rule is in `engine/src/local.ts` and in
`glhf/bixbench/src/bixbench3/paid.py`.

1. The id is `ollama/<name>`, where `<name>` is an Ollama model name: `qwen2.5:14b`, `user/model:tag`.
   Ollama's cloud models (`...:cloud`, `...-cloud`) are **not** local: the local server forwards them to ollama.com.
2. The server is this machine. The address is `LOCAL_MODEL_URL`, else `OLLAMA_BASE_URL`, else
   `http://127.0.0.1:11434`. It must be `localhost`, `127.x.x.x` or `::1`.

An address on another machine is refused unless `LOCAL_MODEL_ALLOW_REMOTE=1` is set. Reason: the switch
`NO_PAID_CALLS` promises that nothing is spent and nothing is sent away. A base URL is only a setting. It could
point at a paid endpoint, or at a server that keeps what it receives. So an address that is not this machine is not
"free and private" unless a person says so.

While `NO_PAID_CALLS` is on, a local-model run still has every provider key blank, and Exa search, past.dev, cloud
runs and the paid checkers stay refused.

## Start Ollama

```bash
ollama serve                 # listens on 127.0.0.1:11434 only; leave it running
ollama list                  # the models on this machine
ollama pull qwen2.5:14b      # 9 GB, once
```

Start at login (Homebrew install). Stop a hand-started `ollama serve` first: both want port 11434.

```bash
brew services start ollama   # a launchd agent for your user; also listens on 127.0.0.1 only
brew services stop ollama
```

Do not set `OLLAMA_HOST=0.0.0.0`. See [Another machine](#another-machine-as-the-host).

Recommended, not required: start the server with `OLLAMA_NO_CLOUD=1`. Then it cannot forward anything to ollama.com
at all. This repo also refuses cloud model ids by name.

### Context length

Ollama loads a model with a context length (`num_ctx`) and silently drops the oldest text when a conversation
grows past it. No error is raised: the model forgets its instructions and the run goes wrong.

- Ollama 0.40 on this Mac Studio (36 GB) chose 32768 tokens by itself (`default_num_ctx=32768` in the server log).
  That is also the most `qwen2.5:14b` supports.
- Older versions and smaller machines default to 4096 or less. That is too small for any solver here.

Check what is loaded: `curl -s 127.0.0.1:11434/api/ps` shows `context_length` (or `ollama ps`).
Set it for the server: `OLLAMA_CONTEXT_LENGTH=32768 ollama serve`.
Or make a named copy of the model with the setting (no download, a few kilobytes):

```bash
printf 'FROM qwen2.5:14b\nPARAMETER num_ctx 32768\n' > /tmp/Modelfile
ollama create qwen2.5-14b-32k -f /tmp/Modelfile     # then use ollama/qwen2.5-14b-32k
```

The OpenAI-compatible endpoint that this repo uses cannot set `num_ctx` per request.

Memory on this machine, measured: `qwen2.5:14b` at 32768 tokens takes 15.2 GB (9.0 GB of weights plus the context).
Ollama unloads a model 5 minutes after its last request.

## Use it

### GLHF, Python command line

```bash
cd glhf/bixbench
uv run python -m bixbench3.glhf_local --case ../demo_case --out /tmp/my-run \
  --solver single --model ollama/qwen2.5:14b --max-tokens 400000
# --solver glhf for the swarm; one role on another local model: --role-model critic=ollama/qwen2.5:7b
```

This works while `NO_PAID_CALLS` is on. `--max-tokens` is not needed by this command, but give it: it is what stops
a model that loops. The sandbox is the usual Docker container with no network; the model runs outside it, on the
host.

### GLHF, engine and dashboard

`engine/src/local.ts` finds local models by asking Ollama (`/api/tags`, 1.5 second limit, cached 15 seconds). It
lists only models that support tools, and no cloud models. When Ollama is not running the list is empty.
`modelCatalogue()` in `engine/src/glhf/types.ts` returns three classes of entry: scripted, local
(`{id, local: true, cost: "free", sizeGb, contextWindow, label}`) and paid.

**Not wired yet.** The run tracker (`engine/src/glhf/tracker.ts`, `task.ts`) and the status endpoint
(`doctor.ts`) are being changed by other work and still treat every model except `mock` as paid. Until the small
change described in the hand-over is applied, the dashboard does not list local models and
`POST /api/glhf/runs` refuses them while paid calls are off. Use the Python command above.

After that change:

- `GET /api/glhf/status` has `models` (ids, local ones included) and `catalogue` (the entries above).
- A run record has `modelClass` (`"scripted" | "local" | "paid"`) and `modelLabel`
  (`"local model (qwen2.5:14b)"`). The dashboard should show `modelLabel` next to every score.
  `run.json` written by the Python runner has `model_class` and `model_label`.
- `maxTokens` is still required for a local model. Nothing is billed, but it is the guard against a model that
  never stops. The cost estimate is 0 and reads `local, free`. Local runs do not count against the daily token cap.
- Starting a local-model run still needs the session token, like every run that is not the scripted demo: it
  holds the machine for many minutes.

### Drug board

```bash
DRUG_BOARD_LOCAL_MODEL=ollama/qwen2.5:14b npm run board      # every agent on this model
DRUG_BOARD_LOCAL_MODEL=1 npm run board                       # per tier, from local_models in board/config.yaml
```

No key is used. A value that is not a local model is an error; it never falls back to scripted
or paid models.

**What a local board run checks: nothing.** Only the agents' text comes from a real model. Because paid calls are
off, the rest stays scripted, exactly as in a mock run:

| Part | In a local board run |
| --- | --- |
| Lead and members | real: the local model writes every turn and the memo |
| Exa literature search | scripted: always the same four fixture papers about KRAS G12C |
| First-pass claim checker | scripted: word overlap, not judgement |
| OpenAI and Claude Code escalation checkers | scripted: fixed verdicts |
| Verdicts in the ledger ("verified", "unsupported") | computed from the scripted checkers: **not evidence** |
| Expertise notes | written to the run folder only, never to `board/expertise/` |
| Cost | $0 |

So a local board run shows whether a local model can follow the board's protocol (call `converse`, write claims in
the right form, write the memo). It does not show that any claim is true.

## What to expect

Measured on this Mac Studio (M4 Max, 36 GB), `ollama/qwen2.5:14b`, the built-in demo case, 14 November 2026.
One run each. The demo case is tiny (two small tables); it tests the plumbing, not science.

| Run | Score | Time | Tokens | Tool calling | Notes |
| --- | --- | --- | --- | --- | --- |
| GLHF single agent (`--solver single`, 400,000-token budget, 1500 s limit) | **1.000** (both artifacts) | 168 s | 58,537 | held: 5 model calls, 8 tool calls, 0 errors | wrote both files and METHODS.md |
| GLHF swarm (`--solver glhf`, same budget and limit) | **0.000** (no artifact written) | 1,470 s (the whole limit) | 171,070 | partly: 34 model calls, 36 tool calls, 4 with wrong arguments, 11 turns with no tool call | every phase ended on its time limit; review was dropped from the plan; the experimenter wrote a script and never ran it |
| Drug board, built-in KRAS brief, every agent local (run in a private copy of the repo with the labelling change applied) | no score exists | 15.9 min (the 15-minute limit) | not recorded | held for `converse` and search: 2 rounds, 16 member replies, 6 searches, 38 claims in the right form | **the lead never wrote the memo**: the run ended "finished" with no `memo.md`. The 20 "verified" verdicts came from scripted checkers and mean nothing. $0. |

Reading these numbers:

- The single agent solved the toy case. The swarm did not: it scored 0. The swarm asks more of a model (nine role
  prompts, hand-offs, a ledger, more tools), and a 14B model at 30 tokens per second could not finish the phases in
  25 minutes. It also called tools with arguments they do not have (`bash_session` with action `write`,
  `text_editor` without `path`). For comparison, earlier paid runs of the same demo case with a frontier model
  scored about 1.0 with both solvers (see [status.md](status.md)); that is a different model on a different day,
  not a matched comparison.
- Tool calls arrived in the right wire format every time (Ollama returned structured tool calls; none came back as
  plain text). The failures were wrong arguments and slowness, not the format.
- Context held: the longest prompt in these runs was 15,993 tokens of 32,768, and the server log shows no
  truncation.
- The board's protocol was followed for two rounds, but the run produced no memo, so a local board run is not usable
  as it is: it needs a longer time limit or fewer members.
- One run each. This says nothing about variance.

Limits:

- A 14B model is far below a frontier model. The demo case is easy; do not expect these scores on a real
  BixBench task, which needs long tool chains, large files and domain knowledge.
- Speed: about 30 tokens per second for this model here. One request at a time (`OLLAMA_NUM_PARALLEL=1`): a matched
  pair, or the board's parallel members, wait for each other.
- Context: 32768 tokens at most for `qwen2.5:14b`. Past that the oldest text is dropped without an error.
- Memory: 15 GB while loaded. Docker Desktop holds 8 GB here. That leaves little room for a second model.
- Scores from a local model must be labelled as such ("local model (qwen2.5:14b)") and never mixed with paid-model
  or scripted results in one comparison.

## Privacy

With a local model on a loopback address, the prompts, the case data the agent reads, and the answers stay on this
machine. No provider key is in the environment of the run. Nothing is sent to Ollama's servers by a chat request to
a local model. Two things do use the network and are outside this repo: `ollama pull` (downloads weights) and
Ollama's cloud models (refused here by id; turn them off with `OLLAMA_NO_CLOUD=1`).

This is a statement about this repo's code and Ollama's documented behaviour. It was checked by test for our side
(the only address reached is the checked one; see `engine/test/local.test.ts` and `tests/unit/test_paid.py`), not by
watching the network.

## Another machine as the host

A teammate can use the Mac Studio's model from a laptop. **Ollama has no authentication.** If it listens on the
network (`OLLAMA_HOST=0.0.0.0`), anyone who can reach port 11434 can run models, read the model list, pull and
delete models. Do not do that on a shared or public network. Nothing below has been set up; these are the options.

| Option | On the Mac Studio | On the laptop | Needs `LOCAL_MODEL_ALLOW_REMOTE` |
| --- | --- | --- | --- |
| SSH tunnel (recommended) | Remote Login on; Ollama stays on 127.0.0.1 | `ssh -N -L 11434:127.0.0.1:11434 user@mac-studio` | no: the laptop sees `127.0.0.1:11434` |
| Tailscale, with SSH tunnel | as above, both machines in one tailnet | the same command with the tailnet name | no |
| Tailscale, direct | `OLLAMA_HOST=<tailnet address>:11434` (never `0.0.0.0`), and a tailnet ACL that allows only the teammates | `LOCAL_MODEL_URL=http://<tailnet address>:11434` | yes, `=1` |
| LAN, direct | not recommended: no authentication, no encryption | | yes |

With the tunnel, the laptop needs no setting at all: `--model ollama/qwen2.5:14b` works as if the model were local,
and runs are labelled `local model (qwen2.5:14b)`. Note that the data then does leave the laptop, to the Mac Studio.
With a direct address the label names the host: `local model (qwen2.5:14b at 100.x.y.z)`.

The Docker sandbox stays on the laptop in both cases. Only model requests go to the Mac Studio, and they queue
there one at a time.

## Larger models

Sizes are from Ollama's registry (checked 14 November 2026, nothing downloaded). Memory and speed are estimates
from the measured 14B numbers.

| Model | Download | In memory at 32k context (estimate) | Speed here (estimate) | Fits beside Docker's 8 GB? |
| --- | --- | --- | --- | --- |
| `qwen2.5:14b` (installed) | 9.0 GB | 15.2 GB (measured) | 30 tokens/s (measured) | yes |
| `qwen2.5-coder:14b` | 9.0 GB | about 15 GB | about 30 tokens/s | yes |
| `qwen3:14b` | 9.3 GB | about 15 GB | about 30 tokens/s, slower in effect because it "thinks" first | yes |
| `qwen3:30b`, `qwen3-coder:30b` (mixture of experts, about 3B active) | 18.6 GB | 23 to 26 GB | 40 to 60 tokens/s | only just: about 2 to 5 GB left for macOS and apps |
| `qwen2.5:32b`, `qwen2.5-coder:32b` | 19.9 GB | 26 to 28 GB | 12 to 14 tokens/s | no |
| `qwen3:32b` | 20.2 GB | 26 to 28 GB | 12 to 14 tokens/s | no |

Arithmetic: 36 GB total, minus 8 GB for Docker, minus about 5 GB for macOS and the apps that are open, leaves about
23 GB. Ollama itself reports 28.1 GiB as usable for models on this machine.

Recommendation: **do not pull a 32B model for this setup.** It would need Docker's memory cut to 4 GB or the
context cut to 8k to 16k, it would be less than half as fast, and the swarm already runs out of time at 30 tokens per
second. If a person wants one experiment, `qwen3-coder:30b` (18.6 GB download; 54 GB of disk are free) is the one
to try, with other apps closed, because its speed should be higher than the 14B model's, not lower. Whether its tool
calls work through Ollama's OpenAI-compatible endpoint with Inspect is untested. `qwen2.5-coder:14b` costs no extra
memory, but reports say it sometimes writes tool calls as plain text; also untested here.
