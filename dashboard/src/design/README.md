# Dashboard design

Anh (@Anhlam09) owns this folder. The code owners are Anh and @itsbrendandang.
Keep changes to the look here. Screens and run logic stay outside this folder.

## Files

| File | What it controls |
|---|---|
| `index.css` | Global tokens, light colors, base type, shared controls and page styles. Also loads Tailwind. |
| `theme.css` | Dark colors and theme overrides. |
| `display.css` | Display headings, round cards, sticker shadows, spacing and thinking motion. |
| `fonts.ts` | Bundled font imports. The main entry loads this file. No outside font service is used. |
| `overview.css` | The question box, Overview Lab container, answer and totals. |
| `research.css` | Research questions, answers, sources and steps. |
| `examples.css` | Example cards and the Examples filter. |
| `board.css` | Team review, statements and the written recommendation. |
| `swarm.css` | Compare and swarm run controls. |
| `lab.css` | The Lab scene, agents, speech bubbles and activity panel. |
| `eventLog.css` | Agent Log rows, filters and downloads. |
| `graph.css` | Graph controls, panels and the text list. |
| `links.css` | The quiet links between views: a run in the Agent Log or the graph, an agent's messages, a source in the inspector. |
| `graph.ts` | Graph colors, shapes, sizes and line lengths. Reads theme tokens. |
| `lab-map.ts` | Room art colors, glass, books and lab equipment colors. |
| `buddy.ts` | Decorative character ink and face positions. |
| `mascot.ts` | Lab character ink and face positions. |
| `identity.ts` | Specialist face shapes, specialist colors and the unknown agent color. |

## Safe changes

Change colors, fonts, spacing, shapes and shadows here. Use the existing tokens.
Check Light and Dark. Keep text readable and keyboard focus visible.
Respect reduced motion. Check wide and narrow screens.

Do not rename class names used by components. Do not change screen files outside
this folder or the engine to change the look. Room assignments, agent names, event
data, walking routes, state and requests are not design settings. Some drawings
and mixed agent records still live with components; do not move or change them as
part of a style edit. Ask a developer if the needed setting is not here.

## Preview

From the repository root, after `npm run setup`, start a Demo engine:

```bash
NO_PAID_CALLS=1 PAID_SWITCH_LOCKED=1 npm run engine
```

In a second terminal, from the same root:

```bash
npm run dashboard
```

Open http://localhost:5317. Demo needs no keys. Never turn paid calls on from an
agent. Do not stop another person's engine. If ports 8787 or 5317 are in use, ask
a developer for an isolated preview with its own run folders and ports.

Before a pull request, run the dashboard checks from the repository root:

```bash
cd dashboard
./node_modules/.bin/tsc --noEmit -p .
./node_modules/.bin/oxlint
./node_modules/.bin/vitest run --maxWorkers=2
```

Also run `npm run check -- --fast` and `npm --prefix dashboard run build` from the
repository root. Say what changed and include Light and Dark screenshots.
