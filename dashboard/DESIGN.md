# Where the dashboard's design lives

For a teammate who wants to change how the dashboard looks or is laid out. Everything is under
`dashboard/src/`. The engine (`engine/`) only supplies data; no layout is decided there.

## Run it

```sh
npm run engine        # from the repo root: data on http://127.0.0.1:8787
cd dashboard && npm run dev   # UI on http://127.0.0.1:5317, reloads on save
```

With Docker only: `docker compose up`, then open http://localhost:5317.

## Map

| You want to change | File or folder |
|---|---|
| Colours, fonts, radius, light and dark theme | `src/index.css` (the variables at the top and the `@theme` block) |
| The shell: side rail, top bar, footer, which view shows | `src/App.tsx`, `src/Dashboard.tsx` |
| The list of views, their names, icons and order | `src/nav.ts` |
| One screen | `src/views/<Name>View.tsx` (Swarm, Board, Experiments, Agents, Settings, Overview, Analytics) |
| Home (chat, plan card, "what this can use") | `src/home/` |
| New run dialog and cancel | `src/swarm/NewRun.tsx`, `src/swarm/CancelRun.tsx`; rules in `src/swarm/runForm.ts` |
| Styles used by one area only | `src/swarm/swarm.css`, `src/board/board.css` |
| Shared pieces (page header, empty and offline states, pills, help text) | `src/components/Shared.tsx` |
| Basic controls (button, dialog, input, select, tooltip) | `src/components/ui/` (shadcn/ui; add with `npx shadcn add <name>`) |
| Chat and Markdown rendering pieces | `src/components/ai-elements/` |
| Number, time and cost formats; status colours and wording | `src/lib/format.ts`, `src/lib/status.ts` |
| Characters (Momo, Ember, Fuji) and avatars | `src/crew/`, `src/components/Buddy.tsx`, `src/components/SideCrew.tsx`; hidden behind the demo flag in `src/crew/store.ts` |
| Calls to the engine | `src/swarm/api.ts`, `src/board/api.ts`, `src/home/api.ts` |
| The desktop window (size, title, icons) | `src-tauri/tauri.conf.json`, `src-tauri/icons/` |

Left over from the template the dashboard started from, and not part of the product: `src/sim/`,
`src/components/SimCard.tsx`, `ParamPanel.tsx`, `Timeline.tsx`, `MetricsChart.tsx`, `src/agent/copilot.ts`,
`CopilotPanel.tsx`, `views/PlaceholderView.tsx`. Check with the team before building on them.

## Rules that the design must keep

- Every result says whether it came from a real model or a scripted one, and paid-calls state is visible.
- Verdicts (supported, refuted, insufficient) must be readable without colour alone.
- A paid action needs a confirm step with the cost; nothing starts from a single click.
- Model and search text is untrusted: render it as text or through the Markdown component, never as HTML.
- Never show or store an API key in the page.

## Check before you push

```sh
cd dashboard && npx tsc -b && npx vite build && npx oxlint && npm test
```

Look at the result at 1440x900 and 1100x800. A layout review with screenshots is kept outside the repo in
`/tmp/design-review/` while it is in progress; its findings will be added to `docs/` when it ends.
