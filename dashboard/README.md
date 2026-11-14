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
  roles, claims, verdicts, issues, score, scoreboard. The start button starts the scripted demo
  only. Start real-model runs from the CLI.
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
- Starting a real-model run from the Swarm view.
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
├── swarm/                    # client for /api/glhf/*, role list, styles
├── board/                    # client for the drug board routes, styles
└── sim/
    ├── types.ts              # Simulation contract
    ├── registry.ts           # simulations shown in the app
    ├── useSimulation.ts      # run loop, metrics history, events
    ├── empty.ts              # fallback shown while the registry is empty
    └── sims/template.ts      # starting point for your own (not registered)
src-tauri/                    # Rust desktop shell
```
