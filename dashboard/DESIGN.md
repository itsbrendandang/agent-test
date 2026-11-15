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

Every view has the same three parts (`src/App.tsx`).

- **The navigation** (`src/components/AppSidebar.tsx`, on the shadcn sidebar in `src/components/ui/sidebar.tsx`).
  - Three places carry the everyday work: Overview, Research, Saved research (ask, read, find again).
  - One quieter group follows, with a heading: "How it works" (Agent Log, Team review, Graph, Agents). `PRIMARY` and
    `MORE` in `src/nav.ts`.
  - Benchmarks and Compare are not in the navigation. They open only by their address (`#Benchmarks`, `#Compare`,
    `#Compare/<id>`).
  - Settings is at the foot, once. The characters sit above it on a wide window.
  - On a wide window the sidebar folds to icons. The choice is remembered (`shell.sidebar`).
  - Under 768 px it is a drawer. The menu button in the header opens it. Choosing a place closes it.
- **One header row**, 48 px high, above the view. It holds the menu button, the name of the place, and two
  slots a view may fill: a title and actions (`src/components/HeaderSlot.tsx`). Research puts the question and
  "New search" there. Nothing else is in the header. There is no status strip and no Demo or Real control in it.
- **The view**, inside one `<main>`. The view scrolls inside it. The header never lies over content.
  Content is at most 1100 px wide, with the same left edge on every view (the Overview's lab and the Agent Log too).
  Graph and Research use a wider column, up to 1480 px (`data-wide` on the view's root element): Graph for its
  picture, Research for its inspector. With the inspector open, Research has no cap and the inspector reaches the
  right edge of the window. Every other view shares the 1100 px column. The Overview and Research start
  screens share one 800 px column for the question box.

Under 480 px the header drops the view's title, so the place name and the actions stay inside the window.

| Place (what a person reads) | Key in the address | File | What it is for |
|---|---|---|---|
| Research | `Home` | `src/views/HomeView.tsx`, `src/home/`, `src/research/` | Ask a research question. Read the answer with its sources, or a plan to confirm |
| Saved research | `Runs` | `src/views/ExperimentsView.tsx` | Every saved answer, team review and task run, with keyword search |
| Compare | `Compare` | `src/views/SwarmView.tsx`, `src/swarm/` | One agent alone against a team of nine on the same task. New run and Cancel |
| Team review | `Board` | `src/views/BoardView.tsx`, `src/board/` | One team review: the decision, the discussion, the checks, the sources |
| Agents | `Agents` | `src/views/AgentsView.tsx` | Who does the work: roles, team members, specialists and methods |
| Graph | `Graph` | `src/views/WorldsView.tsx`, `src/graph/` | One run as a graph of who said what and how it was checked |
| Lab | `Lab` | `src/views/LabView.tsx`, `src/lab/` | Watch the team at work in a run. Characters move only on engine events |
| Settings | `Settings` | `src/views/SettingsView.tsx` | Demo or Real, the session token, appearance, help, what the engine can use |

The keys are addresses and never change (`src/nav.ts`). The words a person reads are in `LABEL` there. Rename a
place by changing `LABEL` only. The address is the key (`#Compare`), and it can name a run (`#Board/<id>`).
Older links still open the right view: `#Swarm` opens Compare, `#Experiments` opens Saved research, `#Worlds`
opens Graph, and the words on screen work too (`#Research`, `#Saved`, `#Review`).

A view that fails shows a message in its own area and leaves the shell working (`src/components/ViewBoundary.tsx`).
The Graph view loads only when it is opened. When the engine cannot be reached, a notice shows in the page with
"Try again" (`EngineNotice` in `src/components/Shared.tsx`).

## Map

| You want to change | File or folder |
|---|---|
| Colours, fonts, the type scale, pills, buttons, the shell layout | `src/index.css` |
| The shell: navigation, header row, which view shows | `src/App.tsx`, `src/components/AppSidebar.tsx`, `src/components/HeaderSlot.tsx`, `src/lib/shell.ts` |
| The list of views, their names and order, and the product name | `src/nav.ts` |
| One screen | `src/views/<Name>View.tsx` (see the table above) |
| Research: the conversation, plan card and confirm step, effort levels, the rows of saved runs under a reply | `src/views/HomeView.tsx`, `src/home/` (rules in `src/home/chat.ts`, engine calls in `src/home/api.ts`) |
| Research: a direct answer (activity, citations, marks, inspector) | `src/research/` (`model.ts` folds the engine's events into the page state) |
| The one row for a saved run, answer or source, and grouping runs of the same brief | `src/components/RecordRow.tsx`, `src/lib/records.ts` |
| How a result was made (Practice, Live research, Local model) | `src/lib/provenance.ts`, `src/components/Provenance.tsx` |
| New run dialog and cancel | `src/swarm/NewRun.tsx`, `src/swarm/CancelRun.tsx`; rules in `src/swarm/runForm.ts` |
| The 3D run graph | `src/graph/` (its own styles in `src/graph/graph.css`) |
| Styles used by one area only | `src/swarm/swarm.css`, `src/board/board.css`, `src/graph/graph.css` |
| Shared pieces: page header, status pill, practice-or-real label (`ModeLabel`), verdict chip (`Verdict`), run id, the engine error/offline card | `src/components/Shared.tsx` |
| The app's words (the four marks, run limit, estimated and spent, the first sentence of a reply, which URLs may be links) | `src/lib/words.ts` |
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
| Characters (Momo, Ember, Fuji, Sage) | `src/crew/store.ts` (who they are, the "Show characters" setting), `src/components/Buddy.tsx` (the drawings), `src/components/SideCrew.tsx` (the foot of the navigation). On by default; Settings turns them off |
| The faces of the agents that did the work (not the characters above) | `src/lab/identity.ts`, `src/lab/AgentAvatar.tsx` |
| AI Elements (Conversation, Message, PromptInput, Suggestion, Sources, Loader, Reasoning) and the shadcn pieces under them | `src/components/ai-elements/`, `src/components/ui/`, `src/lib/utils.ts`; their colours are set at the end of `src/index.css` |
| Tests and their stand-in engine | `src/**/*.test.ts(x)`, `src/test/` |

## One of each

- **One content width**: 1100 px, set once on `.page > *` in `src/index.css`. Do not add a width to a view.
- **One button**: `.btn`, with `.btn-primary` and `.btn-danger`; `.link-btn` for a text link.
- **One pill**: `.pill` with `data-kind` (info, success, warning, danger, neutral, outline, waiting). A verdict is a
  pill with a modifier that also adds a glyph: `pill v-verified`, `pill v-contradicted`, `pill v-unsupported`,
  `pill v-unchecked` (board) and `pill sv-supported`, `pill sv-refuted`, `pill sv-insufficient`,
  `pill sv-untested` (swarm).
- **One type scale**: 12, 13, 15 (conversation text), 16, 20 and 28 px. Nothing under 12.
- **One place for each input**: questions are asked on Research; keyword search is on Saved research; Agents has a filter box.
- **One loading look**: `<Loading>text</Loading>` from `src/components/Crew.tsx`. The text is the status; the
  characters beside it are decoration.
- **One conversation look**: the Research chat, the Team review discussion and "What each role did" on Compare all use the
  AI Elements `Conversation` and `Message` through `src/components/Thread.tsx`.
- **One design system**: AI Elements reads the app's own colours (the token block at the end of `src/index.css`),
  and its visible buttons carry the app's `.btn` classes. Do not add a second theme or button style.

## Removed

The template the dashboard started from is gone: the Overview, Simulations and Analytics views, the placeholder
"Worlds" view (now Graph), the parade, the avatar in the rail, the status line across the top (`StatusLine.tsx`), the seven-item rail, the `.toon-btn` buttons, `src/sim/`, `src/agent/`,
`src/runs/`, `src/system/UsageBars.tsx`, the chart component, and the "Your crew" editor in Agents (it gave the
characters roles and skills, which made decoration look like agents). Settings uses the engine's connection status; API keys are configured on the engine.

Brought back from git history (commit `e071754^`), by the owner's decision: the loading screen
(`Splash.tsx`), and AI Elements with the shadcn pieces it needs. `message.tsx` differs from history in one way:
its Markdown renderer moved to `ai-elements/message-response.tsx`, which nothing imports, so its code-highlight,
maths and diagram plugins (about 740 kB) stay out of the first load. `sources.tsx`, `loader.tsx` and
`ui/collapsible.tsx` were added from the public registries with the shadcn CLI. `reasoning.tsx` (the Agent Log's
"Show thinking") was copied from AI Elements with three changes, listed at the top of the file.

## The characters

Momo, Ember, Fuji and Sage are the app's face, not its workers.

- Where: the loading screen, every waiting state (`Loading`), and the foot of the navigation on a wide window.
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
| ✓ Supported · ✕ Contradicted · ? Insufficient evidence · ○ Not checked (`MARK_WORD`, `MarkChip`) | the engine's own words: verified, refuted, unsupported, untested | tooltip on every chip |
| Run limit · Estimated · Spent (`runLimit`, `estimated`, `spent`) | one word for all three | they are three different numbers and never share a label |
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

- **First visit**: Research says what this is in one sentence, offers one "Try asking" row of questions (see README, "Try asking"), and says once when the app is in Demo mode.
- **Examples fill, Send sends**: an example question only fills the box. Send sends it, so one click on an
  example never starts a run.
- **Fewest clicks**: example (1), Send (2), "Start practice run" (3), "See what they found" (4). A practice plan starts in
  one click only while the engine is in Demo mode and the plan is not paid (`quick` in `src/home/PlanCard.tsx`).
  Everything else keeps the confirm step, the cost and the tick box. Never weaken that.
- **Always a next step**: a progress line while a run works, one clear button when it ends, and a "What next?"
  row on Board and Compare (`.next-steps`). No empty state, error or finished state is a dead end.
- **Errors a person can act on**: what went wrong, what to do ("Start it with: npm start"), one "Try again"
  button, and the engine's own text under "Details" (`EngineOffline` in `Shared.tsx`).
- **Where you were**: the app opens on the Overview (the home page) unless the address names a view. The last run of
  each kind (`last.board`, `last.swarm`) is remembered. An address can name a run: `#Board/<id>`, `#Compare/<id>`
  (`src/nav.ts`, `src/lib/open.ts`).
- **Advanced controls** (model, limits, team choice) sit under "Research options". How a result was made (its
  provenance badge) is never hidden.
- **Help**: "How this works" in Settings opens the four-step picture (`src/components/HowItWorks.tsx`).

## Demo and Real

Two different things, never mixed:

- **How the next run will be made** is the engine's mode: Demo or Real. A person switches it in Settings only
  (`ModeSwitch` and `RealDialog` in `src/components/PaidSwitch.tsx`, engine calls in `src/lib/paidSwitch.ts`).
  The header has no switch: the owner removed it. `NextRun` in the same file is the old header control, kept unused.
- **How a result on screen was made** is its provenance: Practice, Live research or Local model. It comes from the
  record itself (`provenanceOf` in `src/lib/provenance.ts`) and is drawn by one badge
  (`src/components/Provenance.tsx`). It never follows the mode. A practice result seen in Real mode still says Practice.

The switch:

- Under the control: "Demo uses fixed example answers and is free." and "Real uses live AI models and web search,
  which cost money. You confirm before each run." These two lines are also the control's description for a screen reader.
- Choosing Real never flips anything. It opens a dialog: what changes, the limits (per run, per day, searches),
  what was spent today, a tick box "I understand this costs money", and the session-token prompt if none is held.
  Only the ticked box lets the engine's confirm sentence be sent. Escape or "Stay in Demo" changes nothing.
- Choosing Demo is one click, no dialog.
- Missing keys: the dialog says which, and offers no button and no key field. Locked: the control is disabled
  and says "Locked by the person running the engine".
- The state comes from the engine on load and on a 10-second poll (`useShell` in `src/lib/shell.ts`), and again
  right after a switch. Nothing about it is stored in the browser. It goes back to the engine's own setting when
  the engine restarts.
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
  (`src/lib/provenance.ts`, `src/lib/scripted.ts`), never from the engine's state now.
- Marks must be readable without colour alone: ✓ Supported, ✕ Contradicted, ? Insufficient evidence, ○ Not checked.
- Saved runs under a reply are grouped only on the record's own key (a review's brief file, a task run's task, solver
  and model) and the same provenance. A similar title is never enough. Only an AI answer says it "used" them
  (`sourcesWords` in `src/home/chat.ts`).
- Nothing about activity, progress, durations or how much was checked is made up. The page shows what the engine reported.
- A paid action needs a confirm step with the cost; nothing starts from a single click.
- Model and search text is untrusted. A team member's reply in a discussion is plain text. An answer on Research
  and the reasoning under a team's decision are Markdown through `src/components/SafeMarkdown.tsx` only: headings,
  lists, tables, code, and links for `http(s)` addresses (`safeUrl`); no raw HTML, no image, no script address.
  Run documents (memo, findings, methods) go through `streamdown`. Do not use `MessageResponse` for model text.
- The page never calls a model. The `ai` package is installed for AI Elements' types only; replies come from the
  engine's `/api/chat`.
- When the engine answers with an error, show its own text (`EngineOffline said=…`). "Engine not running" is only
  for an engine that cannot be reached.
- Never show or store an API key in the page.

## Check before you push

```sh
cd dashboard && npx tsc -b && npx vite build && npx oxlint && npm test
```

Look at the result at 375, 528, 768 and 1280 px wide. Nothing may be wider than the window. The owner's engine
accepts the dev server on port 5317 only. For your own checks start a practice engine on another port and name your
dev server's address in `DASHBOARD_ORIGINS` (see `AGENTS.md`, "A running engine may be someone's live engine").
