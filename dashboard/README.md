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
| Desktop shell | Tauri 2 in `src-tauri/`. **Paused**; the browser is the supported way to use the app. |

## Commands

```bash
npm install
npm run dev      # http://127.0.0.1:5317 (the port is fixed; the engine only accepts this origin)
npm test         # vitest, in jsdom, with the network blocked
npm run build    # type check and production build
npm run lint     # oxlint
```

## Views

Seven views, one file each in `src/views/`. Each has a URL hash, and an address can name a run
(`#Board/<id>`, `#Compare/<id>`).

| View | File | What it shows |
|---|---|---|
| Home | `HomeView.tsx` | The chat box. Ask about saved research, or ask a research question and get a plan you can start. |
| Runs | `ExperimentsView.tsx` | Every run, with keyword search. |
| Compare | `SwarmView.tsx` | The swarm and the single agent on the same task, side by side. Start a run here (see below). |
| Board | `BoardView.tsx` | One board review: the question, what each member said, how each statement was checked, the sources. |
| Agents | `AgentsView.tsx` | The roles and what each one did. |
| Graph | `WorldsView.tsx`, `src/graph/` | One run as a graph of who said what and what held up, with a replay. |
| Settings | `SettingsView.tsx` | Engine state, Demo or Real mode, session token. |

Home is being simplified into a search-first screen and will be labelled "Search"; Runs will be
labelled "Saved research". File names and routes stay.

## Demo and Real

The status line shows the engine's mode on every view. **Demo** is the default: practice runs with
fixed example answers, free. **Real** uses real AI models and search and costs money. Switching to
Real opens a dialog with the spending limits and a tick box, and needs the engine's session token;
switching back is one click. The state is read from the engine (`GET /api/paid`) and is never stored
in the browser. Code: `src/components/PaidSwitch.tsx`, `src/lib/paidSwitch.ts`.

## Words on screen

The app uses plain words, not the code's words: "statement" (claim), "Holds up / Proven wrong / Not
enough evidence" (verified / contradicted / unsupported), "practice run" (scripted or mock). The full
list is in [DESIGN.md](DESIGN.md#words). A mark appears only when a recorded check produced it, and
"Search powered by Exa" appears only on real Exa results.

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

`src/components/Buddy.tsx` draws the characters (Momo, Ember, Fuji and friends) and `Splash.tsx` the
loading screen. They are decoration: small, and kept away from the main controls. `src/crew/` holds
their saved names and looks.

## Structure

```
src/
├── App.tsx, Dashboard.tsx, nav.ts   # shell, status line, navigation
├── views/                           # the seven views and their tests
├── home/                            # chat client, plan card, effort picker, catalogue panel
├── board/                           # client for the board routes, styles
├── swarm/                           # client for /api/glhf/*, New run form, cancel dialog
├── graph/                           # graph model, narration, canvas (lazy-loaded)
├── components/                      # Thread, PaidSwitch, StatusLine, HowItWorks, characters
│   ├── ai-elements/                 # Vercel AI Elements (generated)
│   └── ui/                          # shadcn/ui (generated)
├── lib/                             # engine address, glossary, paid switch client
└── test/                            # test helpers and fixtures
src-tauri/                           # desktop shell (paused)
```

## Not verified

A real-model run on screen, a run in progress, screen readers, Firefox and Safari. Tests run in
jsdom; the browser checks so far were in Chromium.
