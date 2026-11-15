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
| Shared pieces: page header, status pill, practice-or-real label (`ModeLabel`), verdict chip (`Verdict`), run id, the engine error/offline card | `src/components/Shared.tsx` |
| The app's words (practice run, verdict words, the first sentence of a reply, which URLs may be links) | `src/lib/words.ts` |
| Who said what: one message per team member, with its checks | `src/components/Thread.tsx` (on `src/components/ai-elements/`) |
| Reading from the engine; telling "not running" from "answered with an error" | `src/lib/engine.ts` |
| The loading screen | `src/components/Splash.tsx` |
| The one loading look (`Loading`) and the decorative characters (`Mascots`) | `src/components/Crew.tsx` |
| The session-token prompt | `src/components/TokenPrompt.tsx`, `src/lib/token.ts` |
| Number, time and cost formats | `src/lib/format.ts` |
| Status words and colours; verdict words, glyphs and order | `src/lib/status.ts`, `src/lib/verdict.ts` |
| How a run is known to be scripted or real | `src/lib/scripted.ts` |
| Paid-calls wording | `src/lib/paid.ts` |
| Opening a run in another view | `src/lib/open.ts` |
| Calls to the engine | `src/swarm/api.ts`, `src/board/api.ts`, `src/home/api.ts` |
| Characters (Momo, Ember, Fuji) | `src/crew/store.ts` (who they are, the "Show characters" setting), `src/components/Buddy.tsx` (the drawings), `src/components/SideCrew.tsx` (the rail). On by default; Settings turns them off |
| AI Elements (Conversation, Message, PromptInput, Suggestion, Sources, Loader) and the shadcn pieces under them | `src/components/ai-elements/`, `src/components/ui/`, `src/lib/utils.ts`; their colours are set at the end of `src/index.css` |
| Tests and their stand-in engine | `src/**/*.test.ts(x)`, `src/test/` |
| The desktop window (size, title, icons) | `src-tauri/tauri.conf.json`, `src-tauri/icons/` |

## One of each

- **One content width**: 1100 px, set once on `.page > *` in `src/index.css`. Do not add a width to a view.
- **One button**: `.btn`, with `.btn-primary` and `.btn-danger`; `.link-btn` for a text link.
- **One pill**: `.pill` with `data-kind` (info, success, warning, danger, neutral, outline, waiting). A verdict is a
  pill with a modifier that also adds a glyph: `pill v-verified`, `pill v-contradicted`, `pill v-unsupported`,
  `pill v-unchecked` (board) and `pill sv-supported`, `pill sv-refuted`, `pill sv-insufficient`,
  `pill sv-untested` (swarm).
- **One type scale**: 12, 13, 15 (conversation text), 16, 20 and 28 px. Nothing under 12.
- **One place for each input**: questions are asked on Home; keyword search is on Runs; Agents has a filter box.
- **One loading look**: `<Loading>text</Loading>` from `src/components/Crew.tsx`. The text is the status; the
  characters beside it are decoration.
- **One conversation look**: the Home chat, the Board discussion and "What each role did" on Compare all use the
  AI Elements `Conversation` and `Message` through `src/components/Thread.tsx`.
- **One design system**: AI Elements reads the app's own colours (the token block at the end of `src/index.css`),
  and its visible buttons carry the app's `.btn` classes. Do not add a second theme or button style.

## Removed

The template the dashboard started from is gone: the Overview, Simulations and Analytics views, the placeholder
"Worlds" view (now Graph), the parade, the avatar in the rail, the `.toon-btn` buttons, `src/sim/`, `src/agent/`,
`src/runs/`, `src/system/UsageBars.tsx`, the chart component, and the "Your crew" editor in Agents (it gave the
characters roles and skills, which made decoration look like agents). Settings shows the desktop key form only
inside the desktop app.

Brought back from git history (commit `e071754^`), by the owner's decision: the loading screen
(`Splash.tsx`), and AI Elements with the shadcn pieces it needs. `message.tsx` differs from history in one way:
its Markdown renderer moved to `ai-elements/message-response.tsx`, which nothing imports, so its code-highlight,
maths and diagram plugins (about 740 kB) stay out of the first load. `sources.tsx`, `loader.tsx` and
`ui/collapsible.tsx` were added from the public registries with the shadcn CLI.

## The characters

Momo, Ember and Fuji are the app's face, not its workers.

- Where: the loading screen, the empty Home, every waiting state (`Loading`), next to "See what they found", and
  the rail on wide screens.
- Always `aria-hidden`, always with the real status in text beside them, never the only sign of anything.
- Never shown as the agents that did the work. The team members that ran are named in the conversation and the
  steppers. Next to a practice run the label still says "Practice run".
- Still under `prefers-reduced-motion`. Off with Settings, "Show characters" (localStorage `app.characters`).
- The loading screen shows until the engine's status and catalog have answered: at least 0.7 s, at most 2.5 s,
  gone at once when the engine cannot be reached, and skipped by a click or any key.

## Words

The reader is smart but is not a scientist or an engineer. Plain words first; the expert term is a tooltip or a
small second line, never deleted. The strings and helpers live in `src/lib/words.ts` and `src/lib/format.ts`.

| Say | Not | Where the expert term stays |
|---|---|---|
| Practice run: fixed text, not real research (`PRACTICE`, `ModeLabel`) | scripted, mock | `data-mode="scripted"` |
| ✓ Holds up · ✕ Proven wrong · ? Not enough evidence (`Verdict`) | verified/supported · contradicted/refuted · unsupported/unchecked/insufficient/untested | tooltip on every chip; second text with `technical` |
| statement | claim | ids such as C2; "experts say claim" in How to read this |
| a test that could prove it wrong | falsification test | |
| the team's shared notes / what the run recorded | ledger | |
| result, result file | artefact, output | |
| step, role | phase | |
| a quick first check / a second, more careful check | first pass, escalation | model id in brackets |
| evidence score (experts call it an e-value) | e-value alone | |
| one agent alone / a team of nine | single agent / swarm | |
| scoring program | grader | |
| text limit (tokens) | token budget | |
| web search (Exa) | Exa search | |
| small, fast / strong / the strongest models | cheap / strong / lead tier | |
| review, decision | board run, memo | "memo" in one heading |
| Key for Claude (Anthropic) … | env-var names as titles | the env name as a small second line |
| the question that was asked (`runTitle`, `plainTitle`) | a run id as a title | "Run id:" small, and in tooltips |

Numbers: `plainDuration` ("9 seconds"), `plainLimit` ("30-minute limit"), `plainCost` ("cost nothing (practice
run)"), `plainWhen` ("today at 4:51 pm"). Scores keep three decimals.

## The conversation

The discussion is the centre of Board and Compare: `TeamMessage` in `src/components/Thread.tsx`.

- Who speaks and their job in one plain line (`BOARD_JOB` in `words.ts`, written from `board/agents/*.md`; the
  swarm's from `src/swarm/roles.ts`). Do not invent what a role does.
- The message is the reply's "In short:" sentence (`splitReply`); without one, its first sentence. The rest is
  under "Show full reply". Never an empty bubble.
- One chip per checked statement: glyph and plain word. Pressing it shows the statement, why, who checked, the
  source.
- A statement proven wrong marks the message with a red edge and a line of text, and the view's headline says so.
- All of it is text. Nothing a model wrote becomes HTML, a link or an image.
- Reading size in the conversation is 15 px: the one size added to the scale (12, 13, 15, 16, 20, 28).

Each view opens with the question, a label (practice or real), and one big sentence that says what happened.
A practice run's score or recommendation is never the headline without the words "practice run" in it.

## Easy to use

A first-time visitor gets from opening the app to a finished result, and understands it, without help.

- **First visit**: Home says what this is in one sentence, offers three example questions that send in one click,
  and says once when the app is in Demo mode.
- **Fewest clicks**: example (1), "Start practice run" (2), "See what they found" (3). A practice plan starts in
  one click only while the engine is in Demo mode and the plan is not paid (`quick` in `src/home/PlanCard.tsx`).
  Everything else keeps the confirm step, the cost and the tick box. Never weaken that.
- **Always a next step**: a progress line while a run works, one clear button when it ends, and a "What next?"
  row on Board and Compare (`.next-steps`). No empty state, error or finished state is a dead end.
- **Errors a person can act on**: what went wrong, what to do ("Start it with: npm start"), one "Try again"
  button, and the engine's own text under "Details" (`EngineOffline` in `Shared.tsx`).
- **Where you were**: the last view (`app.view`) and the last run of each kind (`last.board`, `last.swarm`) are
  remembered. An address can name a run: `#Board/<id>`, `#Compare/<id>` (`src/nav.ts`, `src/lib/open.ts`).
- **Advanced controls** (effort, model, limits, team choice) sit under "More options". The Demo/Real state and
  the practice/real label are never hidden.
- **Help in place**: "How this works" in the status line opens the same four-step picture on every view
  (`src/components/HowItWorks.tsx`).

## Demo and Real

There is no bar across the top. One small chip at the foot of the rail says "Demo" or "Real" on every view
(`ModeIndicator`); pressing it opens the switch, a radio group "Demo | Real" with plain words beside it (`ModeSwitch` and `RealDialog` in `src/components/PaidSwitch.tsx`, engine calls in
`src/lib/paidSwitch.ts`; the same control is in Settings).

- Demo: "Practice runs. Fixed example answers. Free." Real: "Real AI models and web search. Costs money."
- Choosing Real never flips anything. It opens a dialog: what changes, the limits (per run, per day, searches),
  what was spent today, a tick box "I understand this costs money", and the session-token prompt if none is held.
  Only the ticked box lets the engine's confirm sentence be sent. Escape or "Stay in Demo" changes nothing.
- Choosing Demo is one click, no dialog.
- Missing keys: the dialog says which, and offers no button and no key field. Locked: the control is disabled
  and says "Locked by the person running the engine".
- The state comes from the engine on load and on a 10-second poll (`useShell`), and again right after a switch.
  Nothing about it is stored in the browser. It goes back to Demo when the engine restarts.
- A run keeps the label it started with. The per-run cost and confirm stay as they are while Real is on.
- Tests stub the engine. Never send `{on: true}` to a real engine from a test or a script.

## Sources and search credit

- `SearchCredit` in `src/components/Shared.tsx` is the only place the wording lives. "Search powered by Exa"
  (Exa links to exa.ai) is shown only for sources whose provider is `exa`: a live Exa search. `europepmc` reads
  "Found in PubMed and preprints (Europe PMC)". `fixture` reads "Example sources (practice run)". No logo.
- A run recorded before the `provider` field follows its own practice flag; a run that says neither gets no credit.
- Where: the search step in the discussion (who searched, the queries, how many results were kept), the Sources
  section on Board, beside the source in a statement's detail, the plan card, and Home's "What this can use".
- Sources on Board: title, site, kind of study and relevance as the engine recorded them, "Preprint: not peer
  reviewed" for a title ending in "[preprint]", and the statements that rest on each with whether the quoted
  passage was found. Titles and addresses are untrusted: text only, links only for http(s) (`safeUrl`).
- While a real run works: "spent so far $x of $y" and "Searching: N of 20 web searches, M of 20 literature
  searches", from the run's own events and the engine's limits.

## Rules that the design must keep

- Every result says whether it came from a real model or was a practice run (fixed text, no model). That comes from the run itself
  (`src/lib/scripted.ts`), never from the engine's state now. Paid-calls state is in the status line on every view.
- Verdicts must be readable without colour alone: ✓ verified or supported, ✕ contradicted or refuted, ? unsupported,
  unchecked, insufficient or untested.
- A paid action needs a confirm step with the cost; nothing starts from a single click.
- Model and search text is untrusted. Replies in a conversation are plain text: no Markdown, no HTML, no image,
  and a link only for an `http(s)` source (`safeUrl`). Run documents (memo, findings, methods) go through
  `streamdown`. Do not use `MessageResponse` for model text without restricting it first.
- The page never calls a model. The `ai` package is installed for AI Elements' types only; replies come from the
  engine's `/api/chat`.
- When the engine answers with an error, show its own text (`EngineOffline said=…`). "Engine not running" is only
  for an engine that cannot be reached.
- Never show or store an API key in the page.

## Check before you push

```sh
cd dashboard && npx tsc -b && npx vite build && npx oxlint && npm test
```

Look at the result at 1440x900, 1280x800 (the desktop window), 1100x800 and 390x844. The dev server must run on
port 5317: the engine accepts no other browser origin.
