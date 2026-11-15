# AI Scientist Bot dashboard

The web app for AI Scientist Bot. It runs in a browser and talks to the engine on port 8787
(change with `VITE_ENGINE_URL`). The engine does the work and holds the API keys; the browser never
sees a key.

**Start it from the repository root with `npm start`**, which starts the engine and this app and
opens `http://127.0.0.1:5317`. To start only this app: `npm run dev` here, with the engine already
running (`npm run engine` in the root).

Where the design lives and which file to change for what: [DESIGN.md](DESIGN.md). Read it before
changing the UI. This page is the short map.

## Stack

| Layer | Library |
|---|---|
| UI | React + Vite + TypeScript |
| Chat and discussion | Vercel [AI Elements](https://github.com/vercel/ai-elements) in `src/components/ai-elements/` |
| Controls | shadcn/ui and Radix in `src/components/ui/` |
| Graph | three.js with `3d-force-graph`, loaded only when the Graph view opens |
| Styling | Tailwind CSS 4, tokens in `src/index.css` |

## Commands

```bash
npm install
npm run dev      # http://127.0.0.1:5317 (the port is fixed; the engine only accepts this origin)
npm test         # vitest, in jsdom, with the network blocked
npm run build    # type check and production build
npm run lint     # oxlint
```

## Views

One file each in `src/views/`. The name in the address (the URL hash) is the view's key and never changes; what
a person reads is the label (`src/nav.ts`). An address can name a run (`#Board/<id>`, `#Compare/<id>`), and older
addresses still work (`#Experiments`, `#Swarm`, `#Worlds`, and the on-screen words `#Research`, `#Saved`, `#Review`).
The views link to each other through the addresses in `src/lib/links.ts`: the Agent Log of a run and one agent
(`#Lab/<kind>/<id>?agent=<name>`, or `#Lab/<kind>?agent=<name>` for the newest run of a kind), the graph of a run
and one node (`#Graph/<kind>/<id>?node=<node id>`), and one agent's card (`#Agents/<name>?from=<kind>`). A choice
made inside a view (a filter, a node, a card) replaces the address without a new history entry; a link to another
view adds one. See "How the screens connect" in the main README.

| Label (navigation) | Key (address) | File | What it shows |
|---|---|---|---|
| Overview | `Overview` | `OverviewView.tsx`, `src/overview/` | The question box, the answer asked from there right under it, then the Agent Lab scene. One quiet line of counts. |
| Research | `Home` | `HomeView.tsx`, `src/research/`, `src/home/` | The conversation: ask a question, watch the work, read the answer with its sources. |
| Saved research | `Runs` | `ExperimentsView.tsx` | Everything that was researched, newest first, with keyword search. Runs of the same brief are one row with their history. |
| Compare | `Compare` | `SwarmView.tsx` | One agent alone and a team of nine on the same task, side by side. Start a run here (see below). |
| Team review | `Board` | `BoardView.tsx` | One team review: the decision, how many statements were checked and why the rest were not, the discussion, the sources. |
| Agents | `Agents` | `AgentsView.tsx` | Who does the work: roles, team members, specialists, methods. |
| Graph | `Graph` | `WorldsView.tsx`, `src/graph/` | One run as a graph of who said what and what each check found, with a replay. |
| Agent Log | `Lab` | `LabView.tsx`, `src/lab/` | Every event of one run, with filters and downloads. (The animated Agent Lab scene is on Overview.) |
| Benchmarks | `Benchmarks` | `BenchmarksView.tsx`, `src/overview/Benchmarks.tsx` | Our benchmark results beside the record to beat. |
| Settings | `Settings` | `SettingsView.tsx` | Run mode (the Demo or Real switch), Usage and limits (spend today and the limits, `src/overview/Credits.tsx`), session token, appearance, help, and a closed "Technical" disclosure with the Connections card, tools, keys (set or not) and file names. |

Overview, Research and Saved research are the primary places: ask, read, find again. One quieter group follows,
with a heading: "How it works" (Agent Log, Team review, Graph, Agents). The groups are `PRIMARY` and `MORE` in
`src/nav.ts`. Benchmarks and Compare are not in the navigation. They open only by their address (`#Benchmarks`,
`#Compare`, `#Compare/<id>`).
Settings has one entry, at the foot of the navigation.

## The shell

`src/App.tsx`: the navigation (`src/components/AppSidebar.tsx`, on the shadcn Sidebar: a compact sidebar that folds
to icons on a wide window, a drawer below 768 px), one header row, and the view inside `<main>`. The header takes
its own row and the view scrolls inside the content area, so nothing lies over content. The header holds the menu
button, the place name, and two slots a view can fill
(`<HeaderSlot area="title" | "actions">`, `src/components/HeaderSlot.tsx`). When the engine cannot be reached, the
page says so once, with "Try again".

Content is at most 1100 px wide, with the same left edge on every view. Graph and Research use the full width
(`data-wide`): Graph for its picture, Research for its inspector. When the inspector is open it reaches the right
edge of the window. Its tabs are Evidence, Hypotheses (when there are some), Results and Activity, on one line. The
Agent Lab scene is on Overview, not in the inspector.

## Run mode (Demo or Real) and provenance

Two different things, never mixed:

- **How the next run is made**: the Demo | Real control in Settings, under "Run mode". It is the one place to
  switch; the header has no switch. **Demo** is the default: fixed example answers, free. **Real** uses live AI
  models and web search and costs money. Choosing Real opens a dialog with the spending limits and a tick box, and
  needs the engine's session token; choosing Demo is one click. The state is read from the engine
  (`GET /api/glhf/status`, `GET /api/paid`), again every few seconds and right after a switch, and is never stored
  in the browser. Code: `ModeSwitch` and `RealDialog` in `src/components/PaidSwitch.tsx`, `src/lib/paidSwitch.ts`,
  `src/lib/shell.ts`. (`NextRun` in the same file is the old header control, kept unused.)
- **How an existing result was made**: the `Provenance` badge (`src/components/Provenance.tsx`): "Practice" or
  "Live research" (or "Local model"), an icon and the word. It is read from the record's own data
  (`provenanceOf` in `src/lib/provenance.ts`) and never from the run mode: a practice result seen while Real is
  chosen still says Practice.

## Words on screen

The app's words are in one module, `src/lib/words.ts`:

- The four marks of a checked statement, each with its glyph: ✓ Supported, ✕ Contradicted, ? Insufficient
  evidence, ○ Not checked (`markOf`, `MARK_WORD`, `MARK_GLYPH`; the chip is `MarkChip` in
  `src/components/Shared.tsx`). A mark appears only where a check was recorded.
- Counts never say that every statement was checked: "99 of 204 statements checked" (`checkedOf`), and a team
  review gives the reasons for the rest from the check records' own notes (`uncheckedReasons` in `src/lib/verdict.ts`).
- Money: "Run limit: $1" (the most a run may spend), "Estimated: about $0.40" (never a promise), "Spent: $0.31"
  (recorded).
- "Search powered by Exa" appears only on real Exa results; a database source is called a record.

Saved runs, answers and sources use one row everywhere: `RecordRow` and `RecordList` in
`src/components/RecordRow.tsx` (title on two lines, type, date and time, provenance, status or result, one Open;
a few rows, then "View all N"). Grouping (`groupRecords` in `src/lib/records.ts`) is exact: the same brief made the
same way. A similar name never groups two records.

## New run form

`src/swarm/NewRun.tsx`. It starts a local run on the demo case (`POST /api/glhf/runs`). It needs
Docker on the engine's machine.

| Field | Values | Notes |
|---|---|---|
| Who does the work | Swarm (9 roles), Single agent, Both | "Both" starts a matched pair with one request: the same model, time limit, token budget and seed, the swarm first, then the single agent. |
| Model | `mock` (default, free), the models the engine offers (those whose key is set), or another model id | `mock` is the scripted model. It does no real analysis. |
| Time limit | 1 to 1,440 minutes, default 30 | The ranges of all number fields come from the engine (`limits`). |
| Token budget | 1,000 to 500,000,000 | Required for a real model. The engine has the same rule. |
| Seed | optional | |
| Review rounds | 1 to 10, default 3 | Swarm only. |
| Exa documentation search, Memory between runs | off by default | Swarm only. |

A real model costs money, so the form adds these steps:

1. A note says that the run costs money.
2. A token budget is required.
3. A second page, "Confirm a paid run", repeats the model, the number of runs, the time limit
   and the token budget.
4. The button "Start paid run" works only after you tick the box "I understand that this
   spends money on the model provider's account".

Other behaviour:

- A warning appears when the engine has no key for an Anthropic or OpenAI model.
- The engine checks every field again (`checkRequest` in `engine/src/glhf/tracker.ts`). Its
  refusal is shown in the form, next to the field when possible.
- The engine starts no local run while another local run is still going. See the table below.

Not in the form: cloud runs, BixBench3 tasks, other case folders, per-role models, a message
limit per role. Start these from the CLI ([../docs/running.md](../docs/running.md)).

The form's logic has automated tests (`src/swarm/NewRun.test.tsx`, `src/swarm/runForm.test.ts`).

### Run control in the dashboard

The engine's run control is described in [../docs/running.md](../docs/running.md#run-control).
The dashboard uses it in this way:

| Engine feature | In the dashboard | Code |
|---|---|---|
| A pair in one request (`solvers`) | "Both" sends one request with `solvers: ["glhf", "single"]`. The swarm run goes first. The single-agent run is queued and starts when the swarm run has ended. | `src/swarm/NewRun.tsx`, `startRun` in `src/swarm/api.ts` |
| One local run at a time (409) | The form shows the engine's message and a link "Open <run id>" to the run that is in the way. | `NewRun.tsx` |
| Cancel | A live or queued run has a **Cancel run** button. A dialog asks first ("Cancel this run?"). It says when a queued partner will be cancelled too. For a cloud run, the engine's refusal with the command to run is shown as it is. | `src/swarm/CancelRun.tsx`, `src/views/SwarmView.tsx` |
| Phases `queued` and `cancelled` | A queued partner reads "Waiting in the queue". A cancelled run reads "This run was cancelled. It has no score." | `SwarmView.tsx` |
| `pairedWith`, `after`, `note` | The run page links to the partner and to the run it was queued behind, and shows the note. | `SwarmView.tsx` |
| `limits` and `models` in `GET /api/glhf/status` | The form takes its ranges and its model list from the engine. With no model key, only `mock` is listed. | `NewRun.tsx` |
| `keys.EXA_API_KEY` | The form says that Exa search is off when the engine has no Exa key. | `NewRun.tsx` |
| `{error, field}` in a 400 answer | The message is shown next to the input that `field` names. Other refusals are shown under the form. | `NewRun.tsx` |
| Registered tests of a claim | The claim list shows planned tests, tests with no result, and results that were "not planned beforehand". | `SwarmView.tsx` |

The form's logic and the API client have unit tests in the dashboard. The cancel dialog and the
run page have none. The engine side is tested in
`engine/test/glhf-runs.test.ts`.

## Characters

`src/components/Buddy.tsx` draws the characters (Momo, Ember, Fuji, Sage and friends) and `Splash.tsx` the
loading screen. They are decoration: small, and kept away from the main controls. `src/crew/` holds
their saved names and looks.

## Structure

```
src/
├── App.tsx, nav.ts                  # the shell and the list of places
├── views/                           # one file per view, and their tests
├── research/, home/                 # the Research conversation: event adapters, answer, composer, inspector, plan card
├── board/                           # client for the team-review routes, styles
├── swarm/                           # client for /api/glhf/*, New run form, cancel dialog
├── graph/                           # graph model, narration, canvas (lazy-loaded)
├── lab/                             # the Lab scene, its adapters, and the agents' pictures (AgentAvatar, identity)
├── components/                      # AppSidebar, HeaderSlot, PaidSwitch, Provenance, RecordRow, Shared, Thread, characters
│   ├── ai-elements/                 # Vercel AI Elements (generated)
│   └── ui/                          # shadcn/ui (generated): sidebar, sheet, tooltip, dialog, …
├── hooks/                           # use-mobile (below 768 px)
├── lib/                             # engine address, words and marks, provenance, records, paid switch client, formats
└── test/                            # test helpers and fixtures
```

Design tokens (colours, spacing, radii, fonts: Geist for text, Geist Mono for durations, ids and counts) are the
CSS variables at the top of `src/index.css`; views read them and do not set colours of their own.

## Not verified

A run in progress with a real model on screen (the one real team review was looked at after it finished), switching
to Real against a live engine (checked with a stand-in engine in tests only), screen readers, Firefox and Safari.
Tests run in jsdom; the browser checks were in headless Chromium at 375, 528, 768 and 1280 px wide.
