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
cd drug-board
pi
```

Pi asks whether you trust the project. Answer yes once. Trust is what lets it
read `.pi/settings.json`; until then it ignores everything below.

Then it loads, in this order:

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
   the scripted mock model.
2. **Never read the benchmark's answers.** Agents see only their task's inputs.
   Reading a grader or a ground-truth bucket voids the run.
3. **Do not commit** `.env`, run folders under `glhf/runs/`, benchmark data, or
   anything with a key in it.
4. **Lessons are not automatic.** A run queues them; a person approves them.

## Using something else

Claude Code reads `AGENTS.md` and `.claude/` and works fine here. Cursor and
plain `git` plus `npm test` work too. Nothing in the build depends on Pi.
