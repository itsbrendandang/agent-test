# AI Scientist Bot

**Ask a science question. A team of AI agents researches it. You see what they found, what they
checked, and what is still uncertain.**

Built for the **SF AI Research Hackathon** (Track 3, AI Scientist Swarms) by team GLHF:
Brendan Dang, Anh Lam and Josh Bustamante.

**Contents:** [Try it](#try-it) · [Demo and Real](#demo-and-real) · [What is in the app](#what-is-in-the-app) ·
[Where things stand](#where-things-stand) · [Benchmarks](#benchmarks) · [How it fits together](#how-it-fits-together) ·
[Words](#words) · [Read more](#read-more)

## Why we built it

An AI model can write a confident answer that is wrong. This app does not ask you to trust the
answer. It shows the work:

1. **You ask.** For example: "Should we take this drug candidate forward?"
2. **Agents work on it.** One searches for sources, one plans, one looks for mistakes, one writes.
3. **Statements are checked against their sources.** A second AI model, from a different company,
   must find the exact passage that backs a statement. Each checked statement gets a mark:
   supported, contradicted, or not enough evidence.
4. **You read the result with the marks.** You can open any statement and see who said it, which
   source it cites, and how it was checked.

The app is allowed to say "I do not know" or "nothing was found". That is better than a guess.

## Run it on your machine

You need a terminal, [Node.js](https://nodejs.org) 24 or newer, and [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/itsbrendandang/agent-test.git && cd agent-test
npm run setup    # once, after cloning
cp .env.example .env    # leave the keys blank for Demo mode
npm run engine
```

In a second terminal, in the same folder:

```bash
npm run dashboard
```

Open http://localhost:5317. Press Ctrl+C in both terminals to stop. Restart after `git pull`.
You can also use `npm start` to start both parts and open the browser.

A new copy starts in **Demo mode**. Demo mode is free and needs no account. Its answers are fixed
examples that show how the app works. They are not research.

## Demo and Real

| | Demo | Real |
|---|---|---|
| Answers | Fixed example text | Written by real AI models |
| Sources | Example sources | Real web and literature searches |
| Cost | Free | Costs money, with limits you see before you start |
| Keys needed | None | Your own keys (below) |

### Turn on Real mode

Only the person who pays for the keys does this.

1. **Add your keys.** Copy the example file and paste your own keys after the `=` signs:

   ```bash
   cp .env.example .env
   ```

   | Key | Needed for |
   |---|---|
   | `ANTHROPIC_API_KEY` | The main AI models (writing, first check) |
   | `OPENAI_API_KEY` | The critic and the second check |
   | `EXA_API_KEY` | Web search |

   The other keys in `.env.example` are optional. `HF_TOKEN` is for benchmark data and cloud
   runs, `PAST_API_KEY` for memory between runs. All settings: [docs/configuration.md](docs/configuration.md).

2. **Check the keys.** This is free. It asks each company for its model list and prints the
   spending limits:

   ```bash
   npm run preflight
   ```

3. **Switch to Real.** Choose one:
   - **For this session:** start the app (`npm start`), open **Settings**, and switch Run mode
     from Demo to Real. The app shows the limits and asks you to confirm. A restart goes back
     to Demo.
   - **Every time:** set `NO_PAID_CALLS=0` in `.env`, then start the app again.

Good to know:

- Keys are never stored in this repository. Each person uses their own. Do not share them or
  paste them in a chat.
- A key alone spends nothing. Real mode is off until the person who pays turns it on.
- Each run has a spending limit, and each day has one too. A run is stopped at its limit.
- Tests and coding agents never spend money. `npm run check` forces paid calls off.

The limits in `board/config.yaml` are **$0.15 per Quick answer**, **$0.60 per Standard answer**,
**$5 per team review**, and **$20 per day** across answers and reviews. Exa also has a **$40
lifetime limit** in the engine's search record. These are limits, not price quotes.

## What is in the app

| Screen | What it is for |
|---|---|
| Overview | Ask in the "Let's research together!" question box. Follow the six-room Agent Lab and its activity panel. The answer is written below. Totals and charts separate practice from research. |
| Research | The chat. Ask a question and read the answer with its sources and its hypotheses. |
| Saved research | Search past runs and open any result. The Examples tab has six read-only practice runs. |
| Compare | A team of nine agents against one agent alone, on the same task. |
| Team review | One review in detail: what each agent said, and how each statement was checked. |
| Agents | The agents and what each one does. |
| Graph | One run as a picture of who said what. |
| Agent Log | Every event of the selected run. Filter by agent or kind of step, search, follow live events, and download the shown log as JSON or CSV. No room picture here; the Lab stays on Overview. |
| Benchmarks | Our benchmark results set out as an evaluation: model, accuracy with its interval, tokens, time and cost, beside the record to beat. |
| Settings | Demo or Real, spending limits, and Appearance: Light, Dark, or Match system. |

The Overview Lab has **three rooms across and two down on wide screens**: Discovery, Planning,
Experiment bench; Evidence review, Quality control, Report studio. The activity panel sits
below it. Narrow screens use fewer columns. Agents walk between rooms along the corridors.
The room art is unchanged. The Lab's look is by Anh Lam.

Research answers can add **method specialists** whose skills fit the question. Code matches
the question to their method notes. They write from the sources found; their sections are
checked and reviewed with the rest of the answer. Quick can add one specialist on the cheap
model tier. Standard can add two on the strong tier. If the cheap model is from a different
company than the writer, the specialist uses the writer's model instead. This keeps its
statement checker independent. A question with no match gets none. See
[docs/research-answer.md](docs/research-answer.md#method-specialists).

Headings use **Bricolage Grotesque**. Cards have rounded corners and offset sticker shadows.
Body text stays Geist. Fonts ship with the dashboard; none are loaded from an outside font
service. Light is the default. Dark and Match system are in Settings → Appearance.

### Example library

Saved research → Examples has six committed Demo runs:

1. **GLP-1 market** — a Quick answer.
2. **Safety and specialists** — hERG risk for KRAS G12C inhibitors, with method specialists.
3. **Hypothesis investigation** — KRAS G12C response and resistance.
4. **Clinical evidence** — KRAS G12C inhibitors in previously treated lung cancer.
5. **Stopped research** — a cancelled answer about KRAS G12C safety and resistance.
6. **KRAS G12C board review** — the bundled team review, through its written recommendation.

Each is labelled **"Example · practice, $0"**, including downloads. They are read-only: they
cannot be changed, deleted, resumed or replayed. They are not counted in totals or spending.
Open them in Research or Team review, the Agent Log, or the Overview Lab.

Set `GLHF_HIDE_EXAMPLES=1` before starting the engine to hide them. To replace the committed
files in `examples/` with fresh scripted Demo runs, make sure port 8812 is free, then run:

```bash
node scripts/generate-examples.mjs
```

The script starts its own engine with paid calls off and locked. It makes the events through
the Demo pipeline, not by hand. These are practice runs, not research or benchmark results.

### Earlier Demo screenshots

The Overview, Research, Team review and Lab pictures below show earlier layouts in **Demo
mode**. They are practice runs: fixed example text, not research. The app labels them "Practice".
The Benchmarks picture is described separately.

**Overview.** Practice runs are counted apart from research, so the big number is only what real
models produced.

![The Overview screen: totals, runs per day and the latest runs](docs/images/overview.png)

**Research.** You ask; the answer is split into hypotheses, each with the sources for and against
it. A mark that rests on one source only says so ("one source only").

![The Research screen with a practice answer split into two hypotheses](docs/images/research.png)

**Team review.** The decision first, then how many statements were checked and how each one did.

![The Team review screen: the recommendation and the counts of supported, contradicted and unproven statements](docs/images/team-review.png)

**Overview's Agent Lab.** The same run as a scene: who is working and who fetched what.
This earlier picture shows the room art, not the current three-column layout or the Agent Log.

![Earlier Demo Lab: six rooms with agents as characters and an activity panel](docs/images/lab.png)

**Benchmarks.** These numbers are real runs, read from the run records. Where something was not
measured the screen says "Not known".

![The Benchmarks screen: the record to beat, and one agent against the team of nine with accuracy, tokens, time and cost](docs/images/benchmarks.png)

## Where things stand

We say only what was really done.

- **Works today:** the app, Demo mode, and a full practice review from question to written
  recommendation.
- **Tested with real AI models, in a small way:** a team of agents and one agent alone both worked
  on 8 benchmark questions. They scored the same (4 of 8), and the team cost more.
- **Not done yet:** a full benchmark run. So we cannot say that a team of agents is better than
  one agent. That is the question this project was built to test.
- **Done once:** a team review with real AI models from start to end. It made 3 web searches
  (Exa) and 5 literature searches, and checked 204 statements: 71 supported, 28 without enough
  evidence, 105 not checked (75 of those are calculations, which the checker cannot re-run), none
  contradicted. It cost $1.31 and took 8 minutes. One run is not evidence that the reviews are
  good.
- **Built, and tested in Demo mode only:** the direct answer in the chat (numbered sources,
  visible steps, hypotheses with sources for and against), and the Lab. No real AI model has
  written a direct answer yet; a real one stays switched off until we turn it on.
- **Open models on Modal:** one open model (Qwen3.6 35B) was served on Modal and ran 82 benchmark
  questions (see Benchmarks). More models are listed in `glhf/openmodels/models.yaml` but are
  switched off.
- **Being built now:** a shared store for what the agents find. Today each run keeps its own
  folder of files; there is no database yet.
- **Memory between runs (past.dev):** wired into the nine-agent swarm only, and a person must
  approve each lesson before it is saved. It has not been used in a full real run. The team
  review and the chat do not use it.

The exact list, with what was tested and how, is in [docs/status.md](docs/status.md).

- **Local shakedown (2026-11-15):** a fresh clone was set up, the test suite, the scripted demo
  (score 1.000), and the web UI all ran on macOS. The full write-up, including what did not work,
  is in [TEST-FINDINGS.md](TEST-FINDINGS.md).

## The brief: Track 3, AI Scientist Swarms

The hackathon's instructions for the track we entered, as given:

> **The question:** can a team of agents reproduce a full computational biology study from raw
> data better than the best single frontier model?
>
> **What to build:** generating hypotheses is the easy part, rejecting the wrong ones is harder.
> Build a multi-agent system where agents with different roles (proposer, experimenter, critic)
> plan, run the analysis and check each other's results before anything is reported.
>
> **Record to beat:** BixBench3 (Edison Scientific), 20 published studies rebuilt from raw data.
> Best score: 0.523.
>
> **Context:** Kosmos (Edison Scientific, 2025) coordinates 200+ agents through a shared world
> model, and independent scientists judged 79.4% of its statements accurate, so about 1 in 5 is
> wrong. Popper (Huang et al., ICML 2025) has agents design falsification experiments with
> Type-I error control.
>
> **Judged on:** score vs. the record and a single-agent baseline on the same compute budget,
> rigour, reproducibility. Report what the swarm rejected as well as what it found.

## Benchmarks

A first report, in words. Charts and a fuller scope come later.

**Two benchmarks, and they are not the same thing.**

| | BixBench3 | BixBench v1.5 |
|---|---|---|
| Who made it | Edison Scientific | FutureHouse (public dataset `futurehouse/BixBench`) |
| The task | Rebuild a published study from raw data: 20 studies | Answer questions about a dataset: 205 questions on 59 datasets |
| Record | 0.523, the number Track 3 asks us to beat | Published numbers exist, but ours cannot be set beside them yet (see below) |
| Our solver | Nine-role swarm, in `glhf/bixbench/` | Three-role swarm (analyst, blind critic, reconciler), in `glhf/bixbench_v1/` |
| Compared with | One agent alone, same model | One agent alone, same model, same token budget by default |

**What we have run with real AI models.**

| Benchmark | What was run | Result |
|---|---|---|
| BixBench3 | No real task yet. | No score. We cannot compare with 0.523. |
| BixBench v1.5 | A pilot: 3 datasets, 8 questions, `anthropic/claude-sonnet-5-5`. | One agent: 4 of 8 correct, 317,110 tokens. Swarm: 4 of 8 correct, 532,394 tokens (about 1.7 times). |
| BixBench v1.5 | 20 datasets, 82 questions, an open model (Qwen3.6 35B) served on Modal, same token limit for both. | One agent: 15 of 82. Swarm: 19 of 82. No difference detected (exact p = 0.29). 42 of the 82 answers were not graded, because no judge model was used; they count as wrong, so both scores are lower bounds. |

The Benchmarks screen in the app shows these rows with their intervals, tokens and time.

Eight questions are far too few to tell the two apart. The pilot also used an older swarm; it
has changed since, and the changes were tested with a scripted model only, not a real one. We
also ran a small practice case of our own with both solvers. That checks that the system works;
it is not a benchmark result.

**How a comparison is kept fair.** This follows what Track 3 is judged on.

- **Same compute budget.** By default the swarm gets the same token total as the single agent.
  A run where the swarm got more is labelled "more budget" and reported apart.
- **Same rules for both.** Same model, sandbox, tools, instructions and time limit. Both get
  the same last turn to record answers when the budget ends.
- **No answers in reach.** The answer key never enters the sandbox or the prompt. Only data
  files are copied in; solution notebooks and write-ups are left out.
- **What was rejected is reported.** Each swarm run lists the answers it threw out and why,
  next to the answers it kept. In the nine-role swarm, a claim that a test rejects also sends the
  files it rests on back for a fix (tested with the scripted model only).
- **Honest statistics.** Each report says how it was graded and whether its numbers can be
  compared with published ones. Today the answer is "no", with the reasons: for example, our
  sandbox has no network and the official one does. Questions that share a dataset are not
  counted as independent evidence.
- **Reproducible.** Every run records its settings, seed, sandbox image and token use.

**What comes next.** A full run of both solvers on one benchmark at the same budget, then
charts of score, cost and what the swarm rejected. Until then we do not claim that a team of
agents beats one agent.

Details: [docs/status.md](docs/status.md), [glhf/bixbench_v1/README.md](glhf/bixbench_v1/README.md),
[docs/reading-results.md](docs/reading-results.md).

## Sponsor tools

What we were given, and what this project really uses. "Called" means a real request was sent.

| Tool | What we use it for | Really called so far? |
|---|---|---|
| [Exa](https://exa.ai) | Web search. The scout agent opens a review with it. The benchmark agents can search tool documentation with it. | Yes. One real team review made 3 searches and checked statements against the pages found. Before that, three searches by hand. |
| [past.dev](https://past.dev) | Long-term memory for the benchmark agents: lessons a person approved are saved and recalled. | Yes, saving and recalling were tested by hand. No full run has used it yet. |
| OpenAI | The second checker and the critic agent (a different company from the main model, on purpose). The judge that grades benchmark answers. | Yes. It made 12 second checks in the one real team review, and `gpt-4o` graded the 8 pilot questions. A teammate's separate baseline also used it. |
| [Modal](https://modal.com) | Cloud computers: to run open models next to Claude and OpenAI models on the benchmark, and to host the app. | Partly. The app is hosted there in Demo mode behind a sign-in (no keys, practice runs only; see below). One open model (Qwen3.6 35B) was served there for 82 benchmark questions; see [glhf/openmodels/README.md](glhf/openmodels/README.md). |
| Tinker (Thinking Machines) | Not used. | No. No code calls it. |
| Devin (Cognition) | Not used. | No. |

The main AI models are Claude models from Anthropic (not a sponsor credit). They were called for
the 8 pilot questions and for one chat question.

**Hosted on Modal (Demo mode).** The app also runs as one private web address on Modal:
`deploy/modal_host/`. The owner gives each teammate a personal access code; nothing is served
without sign-in. The hosted engine has no API key: it does practice reviews and demo answers only,
and says so. Runs are kept on a Modal Volume and survive a container stop; a review that was cut
off continues at the next visit. Swarm and benchmark runs are not available there yet. The
container stops after five idle minutes and then costs nothing. Deploy, access codes, cost and
limits: [deploy/modal_host/README.md](deploy/modal_host/README.md). Real mode in the cloud is
designed, not deployed: [deploy/modal_host/REAL-MODE.md](deploy/modal_host/REAL-MODE.md).

## How it fits together

You use the app in a browser. The app only talks to the engine on your own machine. The engine
holds the keys, enforces the spending limits, and is the only part that reaches outside services.

```mermaid
flowchart TB
    you(["You, in a browser"])
    app["<b>The app</b> (dashboard) · 127.0.0.1:5317<br/>Research · Saved research · Compare · Team review<br/>Agents · Graph · Lab · Settings"]

    subgraph engine["The engine · 127.0.0.1:8787 · on your machine"]
        gate{"Access check and<br/>spending limits"}
        answer["<b>Direct answer</b><br/>search, screen, write,<br/>hypotheses"]
        board["<b>Team review</b><br/>lead scientist + 6 members,<br/>method specialists when they fit"]
        tracker["<b>Run tracker</b><br/>starts and follows<br/>benchmark runs"]
        check["<b>Statement checker</b><br/>the quoted passage must be<br/>in the source"]
    end

    sandbox["<b>Docker sandbox</b>, no network<br/>the swarm (9 roles) or one agent alone,<br/>then the benchmark's own grader"]
    store[("<b>Saved research</b><br/>one folder per run: events,<br/>every check, the written result")]
    paid["<b>Paid services</b> · refused in Demo mode<br/>Anthropic: writing, first check<br/>OpenAI: critic, second check<br/>Exa: web search"]
    free["<b>Free public sources</b><br/>Europe PMC: papers and preprints<br/>ChEMBL · ClinicalTrials.gov · openFDA<br/>Open Targets · UniProt · PubChem"]

    you --> app
    app -- "questions, starts, cancels" --> gate
    gate --> answer
    gate --> board
    gate --> tracker
    answer --> check
    board --> check
    tracker --> sandbox
    check --> store
    sandbox --> store
    store -- "live events" --> app
    answer -.-> free
    board -.-> free
    answer -.-> paid
    board -.-> paid
    check -.-> paid

    classDef local fill:#f4f1e8,stroke:#8a8371,color:#1b1a17
    classDef core fill:#fffdf6,stroke:#8a8371,color:#1b1a17
    classDef paidc fill:#fdecec,stroke:#c0504d,color:#1b1a17
    classDef freec fill:#e9f5ec,stroke:#17824d,color:#1b1a17
    class you,app,store,sandbox local
    class gate,answer,board,tracker,check core
    class paid paidc
    class free freec
```

Solid arrows stay on your machine. Dotted arrows leave it, and only the engine sends them: the
red box costs money and is refused in Demo mode; the green box is free. In a team review only one
member, the scout, searches. The swarm's sandbox has no network at all. A direct answer written
by real models is built but still switched off (see "Where things stand").

The engine is built on a durable agent harness ([Pi Durable](docs/pi-setup.md)). Every step is
saved as it happens. A review that is interrupted, for example by a crash or a restart, continues
where it stopped and does not repeat (or pay again for) finished work. We tested this by stopping
a practice review in the middle.

## Words

| Word | Plain meaning |
|---|---|
| Agent | One AI model given one job and its own instructions. |
| Team review | Agents discuss a written question in rounds, and a lead agent writes a recommendation. In the code it is called "board". |
| Swarm | A team of agents that works through a data-analysis task in a fixed order. |
| Single agent | One AI model doing the whole task alone. We compare the team against it. |
| Practice run | A run in Demo mode, with fixed example answers. Free. Not research. |
| Real run | A run that uses real AI models. It costs money. |
| Benchmark | A public set of tasks with known answers, used to measure a method. Ours is BixBench (biology data analysis). |
| Engine | The program on your machine that runs everything and guards the spending. |

## Check that your copy is healthy

```bash
npm run check    # about 3 minutes; never spends money
```

It prints one line per part, `ok` or `FAIL`. All five parts should print `ok`: no
merge-conflict markers, both type checks clean, engine tests and dashboard tests pass.
If a line says `FAIL` on your copy, run `npm run setup` again first. More about the tests is in
[docs/developers.md](docs/developers.md#tests).

## Working with the Pi coding agent

With [Pi](https://pi.dev) installed, run `pi` in this repository's root. After you trust the
project, it reads `.pi/settings.json`: skills from `.agents/skills/` and the pinned `pi-agents`
package. The profiles in `.pi/agents/` are **advisor**, **dashboard-qa**, **docs-writer** and
**reviewer**. `AGENTS.md` rules apply. The agent never turns paid calls on. Pi uses its own
model account; it is separate from the app's free Demo mode. See [docs/pi-setup.md](docs/pi-setup.md).

## Read more

| If you want to | Read |
|---|---|
| Set up your machine and contribute | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Understand the folders and where new code goes | [docs/codebase.md](docs/codebase.md) |
| See every command, the two parts of the project, the tests and the limits | [docs/developers.md](docs/developers.md) |
| Know exactly what was tested | [docs/status.md](docs/status.md) |
| Understand a team review and what "supported" means | [docs/drug-board.md](docs/drug-board.md) |
| Read results and compare fairly | [docs/reading-results.md](docs/reading-results.md) |
| Use a coding agent on this repository | [AGENTS.md](AGENTS.md) |

## Limits you should know

- "Supported" means a second AI model found a real passage in the source, with the same numbers.
  It does not prove the passage is right, or that the source is good.
- Searches return summaries and short excerpts, not full papers. A true statement can still end
  as "not enough evidence".
- This is a research aid. It does not replace an expert, and it is not medical advice.

## Licence

Our own code is under the MIT licence (`LICENSE`). Two folders are not: `glhf/bixbench/` is a
modified copy of BixBench3 (Edison Scientific, CC BY-SA 4.0; our changes are listed in
`glhf/bixbench/CHANGES.md` and carry the same licence), and `glhf/bixbench_v1/` depends on it and
is offered under CC BY-SA 4.0 as well. Third-party files keep their own terms.
