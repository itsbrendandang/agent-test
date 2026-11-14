# Dashboard

The web UI for the GLHF swarm and the drug candidate board. It talks to the engine on
`http://localhost:8787` (change with `VITE_ENGINE_URL`). Start the engine first: `npm run engine`
in the repository root.

The dashboard started as "Sim Lab", a UI skeleton for simulations. The Simulations, Analytics
and Worlds views and the characters come from that skeleton. No simulation is registered.

The screenshot below shows the old Simulations view, not the Swarm view.

![Simulations view](docs/screenshot.png)

## Stack
| Layer | Library |
|---|---|
| Desktop shell | [Tauri 2](https://tauri.app) (Rust) in `src-tauri/` |
| UI | React + Vite + TypeScript |
| Controls | [ui-sdk](https://ui-sdk.dev) (`@ui-sdk/react`): tabs, sliders, switches, toolbar |
| Copilot chat | Vercel [AI Elements](https://github.com/vercel/ai-elements) in `src/components/ai-elements/` |
| Charts | [Recharts](https://recharts.org) via shadcn/ui `chart` |
| Styling | Tailwind CSS 4 + shadcn/ui tokens |

## Run
```bash
npm install
npm run desktop         # desktop window (needs Rust: brew install rustup && rustup default stable)
npm run dev             # browser only, http://localhost:5317
npm run desktop:build   # packaged app
```

## Views
The icons on the left switch views. Each view also has a URL hash, for example `#Experiments`.
The first view is Swarm.

- **Swarm** (`src/views/SwarmView.tsx`): swarm and single-agent runs from the run tracker: phase,
  roles, claims, verdicts, issues, score, scoreboard. It also has a search box that opens the
  Experiments view, and the **New run** button (see "New run form" below).
- **Board** (`src/views/BoardView.tsx`): the drug candidate board. See `../docs/drug-board.md`.
- **Experiments** (`src/views/ExperimentsView.tsx`): word search and the Ask box over all runs
  (engine routes `/api/search` and `/api/ask`).
- **Overview**: landing page with live CPU and GPU bars (desktop app only), session counts, and run
  history: totals, success rate, a GitHub-style activity graph, and results per AI model. Runs are
  recorded with `recordRun()` in `src/runs/store.ts`; nothing calls it yet, so it starts empty.
- **Simulations**: simulation cards, the canvas, an inspector (Copilot / Controls / Metrics / About),
  a run timeline and a run-status card.
- **Agents** (`src/views/AgentsView.tsx`): the nine roles of the swarm with their budget share and
  instructions (engine route `/api/glhf/roles`), and the character editor: a name, a role, a look
  and a `SKILL.md` for each character. Skills are saved but no agent reads them.
- **Analytics**: charts for every metric the simulation reports, plus events by type.
- **Settings**: connect and test API keys for OpenAI, Anthropic, xAI and Google Gemini. Keys are stored in
  the macOS keychain by the Rust side and never returned to the window. Desktop app only.
- **Worlds**: an empty placeholder.

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

The form has no automated tests.

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

None of this has automated tests in the dashboard. The engine side is tested in
`engine/test/glhf-runs.test.ts`.

## Characters
- `src/components/Buddy.tsx`: SVG characters (bunny, flame, egg, mountain, sprout) with four moods.
- `src/crew/`: the character store (saved in localStorage) and the sprites. The desktop overlay
  window was removed.
- The characters are decoration. In the Swarm view they show which role is working.

Easter eggs (in the side rail):
- Poke a character and it talks back. Poke it five times fast and it looks startled.
- Leave the app alone for 45 seconds and they fall asleep.
- Click the logo five times and the crew strolls across the window.


## Add a simulation
1. Copy `src/sim/sims/template.ts`.
2. Implement `init`, `step`, `draw`, and optionally `metrics` and `drainEvents`. Declared `params`
   become controls automatically; keys in `resetOn` restart the run when changed.
3. Import it in `src/sim/registry.ts` and add it to the `simulations` array.

## Copilot
`src/agent/copilot.ts` is a local placeholder (no model, no API key). It answers status questions and
runs `pause`, `play`, `reset` and `set <parameter> to <value>`. Swap it for the AI SDK's `useChat`
and expose the same actions as tools to use a real model.

## Not wired yet
- Starting a cloud run or a run on a BixBench3 task from the Swarm view.
- Claims and issues of cloud runs (they are in the results bucket).
- Simulations: none is registered.
- No automated tests. `npm run typecheck` in the repository root checks the types.

## Structure
```
src/
├── App.tsx                   # shell: rail, views, simulations layout
├── index.css                 # layout + theme tokens
├── agent/copilot.ts          # placeholder copilot logic
├── components/               # SimCard, Timeline, ParamPanel, MetricsChart, CopilotPanel
│   ├── ai-elements/          # Vercel AI Elements (generated)
│   └── ui/                   # shadcn/ui (generated)
├── crew/                     # character store, sprites, skill starters
├── views/                    # Swarm, Board, Experiments, Agents, Overview, Analytics, Settings, Placeholder
├── swarm/                    # client for /api/glhf/*, New run form, cancel dialog, role list, styles
├── board/                    # client for the drug board routes, styles
└── sim/
    ├── types.ts              # Simulation contract
    ├── registry.ts           # simulations shown in the app
    ├── useSimulation.ts      # run loop, metrics history, events
    ├── empty.ts              # fallback shown while the registry is empty
    └── sims/template.ts      # starting point for your own (not registered)
src-tauri/                    # Rust desktop shell
```
