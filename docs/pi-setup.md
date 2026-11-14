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
| Packages | `.pi/settings.json` | Sub-agents and session memory, installed on first trust |

`AGENTS.md` loads even without trust, so read it yourself before you rely on it.

## The agent profiles

Each profile is a Markdown file in `.pi/agents/`. They exist so a second agent
can check the first one's work without being told the context every time.

- **reviewer** — reads only. Looks first at anything that can spend money or
  start cloud compute, then at benchmark integrity, then at the claim ledger's
  statistics, then at crash recovery.
- **advisor** — reads only. Weighs a design decision and says what would change
  its mind.
- **docs-writer** — Markdown only. Must name the file that proves each claim.
- **dashboard-qa** — `dashboard/` only. Tests in a real browser with the mock
  model, never a paid one.

Start one with the `subagent` tool, or ask Pi in plain words: "have the
reviewer look at the last commit".

## Rules worth repeating to any agent

These are in `AGENTS.md`, and they are the ones that cost real money or
invalidate a result when broken:

1. **Never run a real model without being asked.** The default everywhere is
   the scripted model (`--model mock`). `AGENTS.md` states this rule for cloud
   runs and for the BixBench v1 adapter; apply it to every paid run.
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
