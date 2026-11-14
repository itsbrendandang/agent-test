# Working on this repo with Pi

[Pi](https://pi.dev) is the agent harness this project was built with. You do
not need it: the code, tests and Docker path work without it. Use it if you
want an agent that already knows this repository's rules.

## Install

```bash
brew install pi-coding-agent     # or: npm i -g @earendil-works/pi-coding-agent
pi                               # first run asks for a provider and signs you in
```

Pi needs its own model access, separate from this repo's `.env`. An Anthropic
or OpenAI subscription or API key works.

## First run in this repo

```bash
cd agent-test     # the folder you cloned; the GitHub repository is named agent-test
pi
```

Pi asks whether you trust the project. Answer yes once. Trust is what lets it
read `.pi/settings.json`; until then it ignores everything below.

Then it loads these:

| What | Where | Why it matters |
|---|---|---|
| Repository rules | `AGENTS.md` | The rules every agent follows here |
| Skills | `.agents/skills/` | Exa search, the Biomni method catalog |
| Agent profiles | `.pi/agents/` | reviewer, advisor, docs-writer, dashboard-qa |
| Package | `.pi/settings.json` | One package, `pi-agents` 0.40.1. It gives Pi the tools to start other agents. See below. |

`AGENTS.md` loads even without trust, so read it yourself before you rely on it.

### The one package: `pi-agents`

`.pi/settings.json` declares exactly one package: `npm:pi-agents@0.40.1`.

| Question | Answer |
|---|---|
| Version | 0.40.1. The version is pinned, so an update does not arrive by itself. |
| Source | [github.com/mavam/pi-agents](https://github.com/mavam/pi-agents), published on npm as `pi-agents`. |
| Who wrote it | A third party. It is **not** from the authors of Pi, and not from us. |
| What it can do | It runs inside the Pi agent, with the same access as Pi: your files, your shell, your network, with your user's rights. Trusting this project means trusting this package. Read its code first if that matters to you. |
| What it adds | Five tools: `agent_spawn`, `agent_send`, `agent_wait`, `agent_status`, `agent_stop`. |
| Cost | Each agent that is started uses a model through your Pi account. More agents cost more. |

An earlier version of the settings also declared a session-memory package. It was removed
because it makes model calls in the background, and a teammate would pay for them without
asking for them.

## The agent profiles

Each profile is a Markdown file in `.pi/agents/`. They exist so a second agent
can check the first one's work without being told the context every time.

- **reviewer** — reads only. Looks first at anything that can spend money or
  start cloud compute, then at benchmark integrity, then at the claim ledger's
  statistics, then at crash recovery.
- **advisor** — reads only. Weighs a design decision and says what would change
  its mind.
- **docs-writer** — Markdown only. Must name the file that proves each claim.
- **dashboard-qa** — `dashboard/` only. Tests in a real browser with the
  scripted model (`mock`), never a paid one.

Pi starts a profile with the tool `agent_spawn` from the `pi-agents` package.
The other tools are `agent_send` (send it a message), `agent_wait` (wait for
its answer), `agent_status` (list the agents) and `agent_stop` (stop one).
You can also ask Pi in plain words: "have the reviewer look at the last
commit". There is no tool named `subagent`.

## Rules worth repeating to any agent

These are in `AGENTS.md`, and they are the ones that cost real money or
invalidate a result when broken:

1. **An agent never makes a paid call and never sets `NO_PAID_CALLS=0`.** Only
   the person who pays may. Paid calls are off unless `.env` has
   `NO_PAID_CALLS=0`, so a new clone can only do scripted runs
   (`--model mock`). Before this switch existed (commit `05600b1`), nothing
   made the scripted model the default: a run with keys in `.env` could spend. The Python command lines have the same switch. It does not cover
   `inspect eval` or a script that calls the library functions directly, so
   the agent must still follow the rule itself. Pi's own model use is separate: it
   is paid by your Pi account, not by this repository's keys.
2. **Never read the benchmark's answers.** That means the ground-truth bucket
   (`gs://bixbench3-ground-truth`) and the published results of a benchmark
   paper. Reading them voids the run. The grader's code is in this repository
   and may be read, but it must not be changed.
3. **Do not commit** `.env`, run folders under `glhf/runs/`, benchmark data, or
   anything with a key in it.
4. **Lessons are not automatic.** A run queues them; a person approves them.

## Using something else

Other coding agents work here too. The repository has a `.claude/` folder with
the Exa skill for Claude Code. If your agent does not read `AGENTS.md` by
itself, tell it to read that file first. Plain `git` plus `npm test` also
works. Nothing in the build depends on Pi.

Not tested by us: a first run of Pi on a new clone, and agents other than Pi.
