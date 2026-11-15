# Where the dashboard's design lives

For a teammate who wants to change how the dashboard looks or is laid out. Everything is under
`dashboard/src/`. The engine (`engine/`) only supplies data; no layout is decided there.

## Run it

```sh
npm run engine        # from the repo root: data on http://127.0.0.1:8787
cd dashboard && npm run dev   # UI on http://127.0.0.1:5317, reloads on save
```

With Docker only: `docker compose up`, then open http://localhost:5317.

## The shell

Every view has the same three parts (`src/App.tsx`):

- A status line across the top (`src/components/StatusLine.tsx`): the product name, whether the engine answers,
  and whether paid calls are on or off. Plain text, with a link to Settings.
- A rail on the left with seven views, each an icon and a word. Under 1000 px wide it becomes a row across the top.
- The view itself, inside one `<main>`. Content is at most 1100 px wide and starts at the same left edge in every
  view. Home and Graph use the full width (`data-wide` on the view's root element).

| View (rail label) | Page title | File | What it is for |
|---|---|---|---|
| Home | Home | `src/views/HomeView.tsx`, `src/home/` | Ask a research question; get an answer, cited runs, or a plan to confirm |
| Runs | Runs | `src/views/ExperimentsView.tsx` | Every past run of both kinds, with keyword search |
| Compare | Swarm vs single agent | `src/views/SwarmView.tsx`, `src/swarm/` | The like-for-like scoreboard, one run in detail, New run and Cancel |
| Board | Board review | `src/views/BoardView.tsx`, `src/board/` | A board review: decision, checked claims, discussion |
| Agents | Agents and skills | `src/views/AgentsView.tsx` | The nine swarm roles, the board members and specialists, skills |
| Graph | Graph | `src/views/WorldsView.tsx`, `src/graph/` | A 3D graph of what happened in one run |
| Settings | Settings | `src/views/SettingsView.tsx` | What the engine has (tools, keys set or not), paid calls, the session token |

The view names in the address are the rail labels (`#Compare`). Older links still open the right view:
`#Swarm` opens Compare, `#Experiments` opens Runs, `#Worlds` opens Graph (`src/nav.ts`).

A view that fails shows a message in its own area and leaves the shell working (`src/components/ViewBoundary.tsx`).
The Graph view loads only when it is opened.

## Map

| You want to change | File or folder |
|---|---|
| Colours, fonts, the type scale, pills, buttons, the shell layout | `src/index.css` |
| The shell: status line, rail, which view shows | `src/App.tsx`, `src/components/StatusLine.tsx`, `src/lib/shell.ts` |
| The list of views, their names and order, and the product name | `src/nav.ts` |
| One screen | `src/views/<Name>View.tsx` (see the table above) |
| Home: chat, plan card and confirm step, effort levels, "What was checked", "What this can use" | `src/views/HomeView.tsx`, `src/home/` (rules in `src/home/chat.ts`, engine calls in `src/home/api.ts`) |
| New run dialog and cancel | `src/swarm/NewRun.tsx`, `src/swarm/CancelRun.tsx`; rules in `src/swarm/runForm.ts` |
| The 3D run graph | `src/graph/` (its own styles in `src/graph/graph.css`) |
| Styles used by one area only | `src/swarm/swarm.css`, `src/board/board.css`, `src/graph/graph.css` |
| Shared pieces: page header, status pill, scripted or real label, run id, offline card | `src/components/Shared.tsx` |
| The session-token prompt | `src/components/TokenPrompt.tsx`, `src/lib/token.ts` |
| Number, time and cost formats | `src/lib/format.ts` |
| Status words and colours; verdict words, glyphs and order | `src/lib/status.ts`, `src/lib/verdict.ts` |
| How a run is known to be scripted or real | `src/lib/scripted.ts` |
| Paid-calls wording | `src/lib/paid.ts` |
| Opening a run in another view | `src/lib/open.ts` |
| Calls to the engine | `src/swarm/api.ts`, `src/board/api.ts`, `src/home/api.ts` |
| Characters (Momo, Ember, Fuji) | `src/crew/`, `src/components/Buddy.tsx`, `src/components/SideCrew.tsx`. Off unless the app is built or served with `VITE_DEMO_CREW=1` (`src/crew/store.ts`) |
| Tests and their stand-in engine | `src/**/*.test.ts(x)`, `src/test/` |
| The desktop window (size, title, icons) | `src-tauri/tauri.conf.json`, `src-tauri/icons/` |

## One of each

- **One content width**: 1100 px, set once on `.page > *` in `src/index.css`. Do not add a width to a view.
- **One button**: `.btn`, with `.btn-primary` and `.btn-danger`; `.link-btn` for a text link.
- **One pill**: `.pill` with `data-kind` (info, success, warning, danger, neutral, outline, waiting). A verdict is a
  pill with a modifier that also adds a glyph: `pill v-verified`, `pill v-contradicted`, `pill v-unsupported`,
  `pill v-unchecked` (board) and `pill sv-supported`, `pill sv-refuted`, `pill sv-insufficient`,
  `pill sv-untested` (swarm).
- **One type scale**: 12, 13, 16, 20 and 28 px. Nothing under 12.
- **One place for each input**: questions are asked on Home; keyword search is on Runs.

## Removed

The template the dashboard started from is gone: the Overview, Simulations and Analytics views, the placeholder
"Worlds" view (now Graph), the splash screen, the parade, the avatar in the rail, the `.toon-btn` buttons,
`src/sim/`, `src/agent/`, `src/runs/`, `src/system/UsageBars.tsx`, `src/components/ui/` and
`src/components/ai-elements/`. Markdown from a run is rendered with `streamdown` directly. Settings shows the
desktop key form only inside the desktop app.

## Rules that the design must keep

- Every result says whether it came from a real model or a scripted one. That comes from the run itself
  (`src/lib/scripted.ts`), never from the engine's state now. Paid-calls state is in the status line on every view.
- Verdicts must be readable without colour alone: ✓ verified or supported, ✕ contradicted or refuted, ? unsupported,
  unchecked, insufficient or untested.
- A paid action needs a confirm step with the cost; nothing starts from a single click.
- Model and search text is untrusted: render it as text or through the Markdown component, never as HTML.
- Never show or store an API key in the page.

## Check before you push

```sh
cd dashboard && npx tsc -b && npx vite build && npx oxlint && npm test
```

Look at the result at 1440x900, 1280x800 (the desktop window), 1100x800 and 390x844. The dev server must run on
port 5317: the engine accepts no other browser origin.
