# Proposal: a downloadable desktop app

Status: **a self-contained macOS app was built and tested** (section A below). It carries its own Node
and engine, does practice runs out of the box, and needs no checkout and no terminal. Sections 0 to 6 are
the earlier analysis; where they say option (b) is "a plan only" or that the engine cannot yet run from
a bundle, section A supersedes them. Sizes and hours marked "estimate" in sections 0 to 6 were not measured.

## Download and open

For a person who only wants to use it. Apple Silicon Macs only (M1 or newer), macOS 11 or later.

1. Download `AI Scientist Bot_0.1.0_aarch64.dmg` and double-click it.
2. Drag **AI Scientist Bot** onto **Applications** in the window that opens. Then eject the disk image.
3. Open **Applications** and double-click **AI Scientist Bot**. macOS will refuse the first time: the app
   is not signed by an identified developer (there is no paid Apple Developer account behind it). This is
   expected. Click **Done** (or **Cancel**).
4. Open **System Settings**, then **Privacy & Security**, and scroll down to **Security**. You will see
   *"AI Scientist Bot" was blocked to protect your Mac.* Click **Open Anyway**, confirm, and enter your password
   or use Touch ID. You do this once. On macOS 14 and older you can instead Control-click the app, choose
   **Open**, then **Open** again.
5. If macOS says the app is **damaged**, open **Terminal** once and run
   `xattr -dr com.apple.quarantine "/Applications/AI Scientist Bot.app"`, then open the app again.
6. The app opens after a second or two. It starts its own engine; you do not start anything.
   **Paid calls are off.** The app does practice runs: replies are fixed text written in advance, not
   research, and every screen says so. No key is needed and none is inside the app.

Your runs are kept in `~/Library/Application Support/com.brendandang.aiscientistbot/`. Quit the app with
Cmd-Q; its engine stops with it. Delete that folder to remove the data. To remove the app, drag it to the Bin.

What does not work in this app: swarm runs and the benchmark (they need Docker, uv and Python, which are not
included), real model runs (paid calls are off and there is no key screen yet), and Claude Code checking.
Each of these says so in plain words instead of failing silently (list in section A).

## A. The self-contained app (built and tested)

### What it is

| | |
|---|---|
| Inside the .app | `Contents/Resources/engine-app/`: the official Node binary (`node`), `engine/` (source plus 47 MB of production `node_modules`, trimmed of maps, type files and docs), `board/` (config.yaml, agents, context, briefs), `glhf/specialists/*.md`, `skills/*/SKILL.md`, `watchdog.mjs`, `NODE-LICENSE`. No Python, Docker file, test, source map, `.env` or key (the build fails if one is staged). |
| Frontend | The production dashboard build (`vite build`), served by the Tauri webview as `tauri://localhost`. No dev server. |
| Start | The app takes a lock, makes its working folder, starts **one** `node` process on a free port of `127.0.0.1`, waits for `/api/status`, then opens the window. |
| Stop | Cmd-Q sends SIGTERM to the engine's process group (the engine releases its run locks), SIGKILL after 5 s. If the app is killed or crashes, the engine stops itself within about 2 s (`--import watchdog.mjs` checks that its parent is alive). |
| Second copy | The second launch cannot get the lock (`app.lock`), prints a line and exits. One engine only. |
| Data | `~/Library/Application Support/com.brendandang.aiscientistbot/`: `engine-root/board/runs`, `board/expertise`, `glhf/runs` (tracker database, session token), `glhf/memory`, `logs/engine.log`, `app.lock`. Nothing is written inside the .app or at the home root. |
| Paid calls | Off: the engine is started with `NO_PAID_CALLS=1` and an empty environment (no key passes through from the shell). |

### How the engine runs from a read-only bundle with no engine change

The engine takes its "repository root" from where its source file is, and writes runs under it. So the app
builds `engine-root/` in Application Support: `engine` and the read-only board files are **symbolic links** into
the bundle, and the four folders the engine writes to are real folders. Node is started with
`--preserve-symlinks --preserve-symlinks-main` so the engine sees the link path as its root. Only environment
variables the engine already reads are used: `DRUG_BOARD_PORT`, `HOST=127.0.0.1`, `DASHBOARD_ORIGINS=tauri://localhost`,
`GLHF_RUNS_DIR`, `NO_PAID_CALLS=1`. **No engine change was needed.** Node also gets `--max-old-space-size=512`
(the engine's heap stays far below that; it only caps a runaway). The origin, host, content-type and token
checks are untouched: a foreign `Origin` and a foreign `Host` are still refused with 403 (tested in the app).
If the engine later gets a `DRUG_BOARD_HOME` variable, the symbolic links can go; it was offered, not needed.

### How the page finds a port it did not know at build time

The dashboard is built with `VITE_ENGINE_URL=http://engine.localhost`. The window gets an initialisation script
that rewrites addresses starting with exactly that origin to `http://127.0.0.1:<port>` in `fetch`,
`EventSource` and `XMLHttpRequest`. Look-alike hosts (`engine.localhost.evil.com`) are not rewritten (tested).
The content-security policy of this build allows `connect-src http://127.0.0.1:*` in place of port 8787: any
port of this machine's loopback, nothing remote. The window is declared with `create: false` and opened by the
Rust code after the engine answers. Settings shows the address `http://engine.localhost`; that text and its
"reads its keys from .env" line are dashboard text to fix.

### Signing

Ad-hoc: `codesign` reports `Signature=adhoc, flags=runtime`, `--verify --deep --strict` passes. The bundled
`node` keeps the **Node.js Foundation Developer ID signature** it was published with (hardened runtime, the JIT
entitlements Node needs); it is not changed, so it stays valid. There is no other program in the bundle: the
build checks that no other Mach-O file is staged, and the engine has no native modules (`*.node`: none).
`spctl -a -vv` says **rejected**, which is what an app without a Developer ID gets.

**What Gatekeeper shows a downloader:** "AI Scientist Bot" Not Opened, Apple could not verify it is free of
malware; buttons Done and Move to Trash. Steps to open: "Download and open" above (Open Anyway). Not observed
here: no quarantined copy was opened, because the screen of this Mac was locked during testing.

### Node runtime

| | |
|---|---|
| Version | v26.13.1 (Node 26 "Lithium", the long-term-support line; the engine was developed on 26.13.0) |
| URL | https://nodejs.org/dist/v26.13.1/node-v26.13.1-darwin-arm64.tar.gz |
| SHA-256 | `aec2514ea1ceb2ba52455e9ec65986f6749a06dd759e5db2a72e6889668c9735` (equals the line in `SHASUMS256.txt` on nodejs.org; pinned in `scripts/desktop/build.sh`, which refuses a file that does not match). The GPG signature of `SHASUMS256.txt` was not checked. |
| Licence | MIT (the `LICENSE` file of the tarball, copied into the app as `NODE-LICENSE`; it also lists the licences of the libraries inside Node). |
| Size | 147 MB on disk. |

### What does not work inside the app, and what the person sees

| Feature | What happens |
|---|---|
| Swarm run (needs Docker, uv, Python, the harness source) | The run is accepted and ends at once as failed: "the local runner could not be started: the folder to start it in does not exist (...)". Tested. It names a folder inside the app's data folder and does not say "not included in this app". |
| Real model run, cloud run, Exa | Refused with 400 and a field: "runs with a real model are refused ... Paid calls are off (NO_PAID_CALLS)". Tested. The text says to edit `.env`; the app has none. |
| Ask with a model | Answers by keyword and says so ("no model was asked"). Tested. |
| Claude Code checker | Used only in real runs, which are refused. Not reachable. Not exercised. |
| Local model (Ollama) when it is not installed | The model list only offers "mock". Not exercised with Ollama present or absent in the app. |
| BixBench results (`/api/bixv1`) | Empty list: the results folder is not in the app. Tested (200, `[]`). |
| Engine fails to start (files missing, no free port, crash at start) | A dialog: "AI Scientist Bot could not start its engine", with the reason and the log path; the app then quits. The symbolic-link case was triggered by hand and the dialog text read. |

### Keys and paid calls: what a later step would take (not built)

`src/keys.rs` already stores keys for openai, anthropic, xai and google in the keychain and never returns them
to the window. To use them, `Engine::start` would read the saved keys in Rust and add `ANTHROPIC_API_KEY` and
`OPENAI_API_KEY` (and `EXA_API_KEY`, which has no keychain slot yet) to the child's environment, so a key never
passes through the page. It would need: those providers added to `keys.rs` and Settings, an engine restart after a
key changes (mock mode is decided at start), and a separate, deliberate "allow paid calls" switch that sets
`NO_PAID_CALLS=0` for the child, off by default and showing the spending caps. Today the child is started
with an empty environment on purpose. Starting a real board run also needs both Anthropic and OpenAI keys
(the board's lead and skeptic are on different vendors).

### Memory (measured; Apple Silicon, macOS, screen locked, so views were not drawn on screen)

Resident memory (`ps` RSS) and `footprint` (macOS's figure for private memory; shared system pages not counted
twice). Two measurement runs differ in the GPU figure, so ranges are given.

| State | App shell | Engine (node) | Webview helpers (WebContent + GPU + Networking) | All 5 processes, RSS |
|---|---|---|---|---|
| Idle on Home, 25 s after launch | 110 to 116 MB (footprint 32 to 34) | 133 to 136 MB (footprint 77 to 81) | 107 to 150 MB RSS | 351 to 401 MB |
| Idle after one finished practice run | 110 to 116 MB | 142 MB (footprint 85 to 86) | 107 to 150 MB | 360 to 406 MB |
| Graph view open (relaunch on the same data) | 112 to 119 MB (footprint 37) | 134 to 135 MB (footprint 71 to 78) | 229 to 236 MB RSS (WebContent 166 MB, GPU 50 to 56 MB) | 478 to 481 MB |

After quit, no app, engine or webview helper process is left. Processes of the app: 5, namely the shell, one
`node`, and WebKit's three helpers (WebContent, GPU, Networking). The engine's watchdog is inside the same
`node` process, not a helper. The app has no file watchers of its own; the engine watches a run's event
file only while a dashboard stream for that run is open.

What explains the numbers:
- **Shell 110 MB RSS but 32 to 37 MB footprint.** RSS counts the WebKit and AppKit pages that come from the
  system's shared cache and are shared with every other app. The private cost is the footprint.
- **Engine 133 MB.** A bare Node 26 process is 47 MB; running TypeScript directly (type stripping) adds about
  25 MB; the engine's modules and SQLite the rest. The run adds about 9 MB. It cannot go lower without
  compiling the engine to JavaScript, which is an engine change. The heap cap is 512 MB and nothing came near it.
- **GPU helper footprint 13 to 244 MB.** The macOS compositor and WebGL buffers; it changed between runs with
  nothing else changing, and the Graph view's WebGL context is the largest part. A hidden or locked screen
  does not draw, so a Graph view on a visible screen may differ. That number is the least certain here.
- The Graph view was opened by relaunching with `ASB_START_VIEW=Graph` (a letters-only variable the app reads to
  pick the first view); the view change was inferred from the page's network behaviour and from the memory
  jump, not seen.

### Sizes

| | |
|---|---|
| `.app` | 196 MB on disk (`du`). Node 147 MB, engine modules 47 MB, dashboard and shell about 5 MB. |
| `.dmg` | 56,401,640 bytes (53.8 MiB), compressed. Before trimming `node_modules` it was 68.5 MB. |
| Earlier window-only image (step 1) | 3,343,154 bytes. |

### How to rebuild

```sh
scripts/desktop/build.sh                        # dashboard from the working tree
DASHBOARD_FROM=head scripts/desktop/build.sh    # dashboard from the last commit, when dashboard/src does not compile
# about 75 to 100 s with Rust dependencies compiled; first time longer. Output: dashboard/src-tauri/target/artifacts/step2/
scripts/desktop/verify.sh "/private/tmp/some/AI Scientist Bot.app"     # clean-environment proof (copy the app out of the repo first)
scripts/desktop/measure.sh "/private/tmp/some/AI Scientist Bot.app"    # memory table above
```

Needs Apple Silicon, Rust (rustup), Node and npm on the build machine only, and network on the first build
(Node tarball, `npm ci`). Run the app from a real folder, not through a symbolic link such as `/tmp`: Tauri
refuses to resolve its resources through a link, and the app then shows the dialog above. `verify.sh` leaves
temporary data under `/private/tmp/asb-run-*`. The `ASB_START_VIEW` variable and `verify.sh` need the Mac
unlocked for the window check.

### Verified (clean environment, copy outside the repo, then from the mounted .dmg)

`verify.sh` ran from a copy at `/private/tmp` and from the mounted disk image (read-only). It starts the app with
`env -i` (HOME, PATH=/usr/bin:/bin, TMPDIR, USER only; a throwaway HOME), so there is no system Node, no repo and no
dev engine (the dev engine on 8787 stayed up and was not touched). 21 checks, all passed on the final image:
window opens; engine on its own port, bound to 127.0.0.1; the page's network process holds connections to that
port; paid calls off and no key; catalogue (19 agents) loaded from the app's engine; run list starts empty (the
dev engine's runs are not visible); foreign Origin and Host refused; a paid-model run refused; a practice board
run started from a Home plan finishes with a memo; the run is under Application Support; a swarm run fails
with a plain message; a second launch starts no second engine; after quit no process is left; after relaunch
the run is still listed; after `kill -9` of the app the engine stops within 4 s and the app starts again;
nothing inside the app changed (hash of every file, and no file newer than the start); nothing at the home root.

Not verified: clicking through the window (the Mac's screen was locked: the Home start flow was run through the
same API calls Home makes, not with the mouse), opening a quarantined download, a second Mac, Intel, any macOS
but this one, the Graph view on a visible screen, and any paid path.

## 0. Short answer

**For the hackathon, ship option (a): the window as a download, the engine started separately.**
The .dmg is built (5.5 MB, Apple Silicon, ad-hoc signed, not notarised) and works against a
running engine.

**Do not start option (b) before the deadline.** It is about 10 to 14 hours, not 3, and it is
not low risk. Three things make it so, and none of them is in the desktop shell:

1. The engine writes run folders inside its own source tree. Inside an application bundle that
   is a read-only, signed place. The engine needs a separate data folder first (section 3b).
2. The engine reads keys only from environment variables and the repo's `.env`. The app's
   keychain commands store keys for four providers, and the key the drug board needs that is
   not among them is Exa's (the Anthropic and OpenAI keys are). Nothing hands a keychain key to the engine
   (section 2).
3. Paid calls are off unless `NO_PAID_CALLS=0` is in `.env`. A downloaded app has no `.env`, so
   it needs a deliberate switch of its own.

So today **a downloaded app cannot do real research without a repo checkout**. It can show and
start runs on an engine that someone started from a checkout.

## 1. What exists today

| | |
|---|---|
| Command | `cd dashboard && PATH=/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH nice npx tauri build --bundles app,dmg` (on a Mac, `npm run desktop:build` does the same) |
| Time | 1 min 4 s with dependencies already compiled (frontend build, 40 s Rust link, bundling). A first build from nothing compiles the 458 crates in Cargo.lock and was not timed. |
| App | `dashboard/src-tauri/target/release/bundle/macos/AI Scientist Bot.app`, 7.3 MB |
| Disk image | `dashboard/src-tauri/target/release/bundle/dmg/AI Scientist Bot_0.1.0_aarch64.dmg`, 5,745,492 bytes (5.5 MB) |
| Architecture | arm64 only (Apple Silicon). Minimum macOS 11. |
| Signature | Ad-hoc (`"signingIdentity": "-"` in `tauri.conf.json`). No Developer ID: `security find-identity -v -p codesigning` reports 0 valid identities. Not notarised. `spctl` rejects it, as expected. |
| In git | No. `dashboard/src-tauri/target/` is ignored. |

The disk image changes on every build, so record its checksum when publishing:
`shasum -a 256 "dashboard/src-tauri/target/release/bundle/dmg/AI Scientist Bot_0.1.0_aarch64.dmg"`.

Why ad-hoc and not fully unsigned: a build made with `--no-sign` has a signature on the binary
but none on the bundle (`codesign --verify` fails with "code has no resources but signature
indicates they must be present"). On Apple Silicon a downloaded app in that state is commonly
reported as "damaged and can't be opened", which has no Open Anyway route. Ad-hoc signing gives a
valid bundle (`valid on disk`), so the downloader gets the ordinary unidentified-developer
prompt instead. Neither prompt was observed here (section 6).

### Other machines

- **Intel Mac.** This build will not run there. On this Mac:
  `rustup target add x86_64-apple-darwin`, then
  `npx tauri build --target universal-apple-darwin --bundles app,dmg` for one image that runs on
  both (roughly double the size), or `--target x86_64-apple-darwin` for Intel only. Not tried.
- **Windows.** It has to be built on Windows: Rust (MSVC toolchain), the Visual Studio C++ build
  tools, Node, then `npx tauri build --bundles nsis`. WebView2 ships with Windows 11. Two known
  gaps: `keyring` is compiled with the `apple-native` feature only, so saved keys would not
  persist until `windows-native` is added in `Cargo.toml`; and the GPU bar has no reading. The
  engine already accepts the Windows app's origin (`http://tauri.localhost`). The engine itself on
  Windows is a separate question (it shells out to `sh`, `ps`, `uv`, `docker`). Not tried.

### Publishing

A GitHub Release on the private repository. The remote is `itsbrendandang/agent-test`. Only
people with access to the repository can download from it. Do not commit the image.

```sh
gh release create desktop-v0.1.0 \
  "dashboard/src-tauri/target/release/bundle/dmg/AI Scientist Bot_0.1.0_aarch64.dmg#AI Scientist Bot 0.1.0 for Apple Silicon (unsigned)" \
  --repo itsbrendandang/agent-test \
  --title "AI Scientist Bot desktop 0.1.0" \
  --prerelease \
  --notes "Window only: needs the engine running on 127.0.0.1:8787 (docs/running.md). Apple Silicon. Not signed by an identified developer: see docs/proposals/desktop-app.md, section 1, for how to open it."
```

This creates a tag on the default branch's current commit. It was not run.

### What a person downloading it sees

1. Downloads the .dmg in a browser, opens it, drags AI Scientist Bot to Applications.
2. Opens it. macOS 15 and later show: **"AI Scientist Bot" Not Opened. Apple could not verify "Drug
   Board" is free of malware that may harm your Mac or compromise your privacy.** The buttons are
   Done and Move to Trash. Choose Done.
3. The supported way to open it: System Settings, Privacy & Security, scroll to Security, where
   it says "AI Scientist Bot" was blocked to protect your Mac. Click **Open Anyway**, confirm, and
   enter the password or use Touch ID. The button is offered for about an hour after step 2.
   This is needed once. On macOS 14 and earlier: Control-click the app, Open, then Open.
4. The window opens. If the engine is not running on port 8787, each view says the engine is
   offline. The engine has to be started from a checkout (`npm run engine` or
   `docker compose up`, see `docs/running.md`).
5. In Settings, saving a key makes macOS ask once for keychain access. Because the signature is
   ad-hoc, a new version of the app is a different program to the keychain and asks again.

A file fetched with `gh release download` or `curl` is not marked as downloaded by a browser, so
steps 2 and 3 should not appear. Not tested.

### What signing and notarisation need

- An Apple Developer Program membership (99 USD a year; enrolment can take a day or more).
- A **Developer ID Application** certificate in the login keychain of the build machine. Put its
  name in `bundle.macOS.signingIdentity` in place of `"-"`.
- Notarisation credentials in the environment at build time: `APPLE_ID`, `APPLE_PASSWORD` (an
  app-specific password) and `APPLE_TEAM_ID`, or an App Store Connect key as `APPLE_API_KEY`,
  `APPLE_API_ISSUER` and `APPLE_API_KEY_PATH`. The build log already says it skips notarisation
  because these are missing; with them the Tauri CLI submits and staples by itself.
- Then the downloader sees only "downloaded from the Internet, are you sure", and the keychain
  stops asking again after each update.

## 2. Keys today: the app and the engine do not meet

**The app.** Settings calls five commands in `dashboard/src-tauri/src/`:

| Command | Does |
|---|---|
| `keys_status` | For each provider, whether a key is saved. Never the key. |
| `key_save` | Stores a key in the macOS keychain (service `com.brendandang.drugboard`, account `api-key.<provider>`). |
| `key_delete` | Removes it. |
| `key_test` | Lists models at the provider with the saved key and reports whether it was accepted. |
| `system_usage` | CPU and GPU load. Not about keys. |

The providers are OpenAI, Anthropic, xAI and Google. The Settings page says so itself: "No agent
uses them yet."

**The engine.** `engine/src/env.ts` loads the `.env` beside the repo root into `process.env`,
and everything reads `process.env`. There is no keychain code and no route that accepts a key.
What it uses:

| Purpose | Variable | In the app's keychain list? |
|---|---|---|
| Board search (if a member has the tool), swarm `--exa` | `EXA_API_KEY` | No |
| Board `rival` tier and checkers, benchmark judge | `OPENAI_API_KEY` | Yes |
| Board `lead`, `strong`, `cheap` tiers, swarm agents, Ask box | `ANTHROPIC_API_KEY` | Yes |
| Gated benchmark dataset | `HF_TOKEN` | No |
| Allow anything paid | `NO_PAID_CALLS=0` | Not a key; `.env` only |

With paid calls off the board runs on scripted models (`mockMode` in `engine/src/config.ts`). That is
decided once, when the engine starts. With paid calls on and a tier's key missing, a board run is
refused when it starts.

## 3. Three ways to make the download self-contained

| | (a) Window only | (b) App starts the engine | (c) (b) plus first-run checks |
|---|---|---|---|
| Effort | 0 h (done). About 1 h for a release and a short install note. | 10 to 14 h (estimate) | (b) plus 4 to 6 h (estimate) |
| Download | 5.5 MB (measured) | 75 to 90 MB (estimate) | Same as (b) |
| User also needs | A repo checkout, Node 26 or Docker, a terminal | Nothing for board research. uv and Docker for benchmark runs. | Same as (b), and is told so |
| Real research from a download alone | No | Yes, drug board only | Yes, drug board only |
| Risk | Low | Medium to high | Same, plus the PATH problem below |

### (a) Window only (today)

The app is a window on `http://localhost:8787`. The engine runs from a checkout, with
`npm run engine` or `docker compose up --build`. Keys stay in `.env`.

- Good: it exists, it is small, and it cannot break the engine. The engine already allows the
  app's origin (`tauri://localhost` is in `DEFAULT_ORIGINS` in `engine/src/http.ts`), which is
  why the release build loaded data without any engine change.
- Bad: "downloadable" is true of the window only. Anyone who can run the engine can also open
  `http://localhost:5317` in a browser, so the download adds the CPU and GPU bars and the key
  tests, and little else.
- With `docker compose`, the engine container and the app both work on port 8787; the compose
  file sets `DASHBOARD_ORIGINS` and the built-in origins still apply.

### (b) The app starts the engine

**Packaging.** Ship a Node runtime and the engine as files, not as a Node single executable. The
engine is TypeScript run directly by Node, finds its files from `import.meta.url`, and has ES
module dependencies; a single executable needs a bundler step and breaks all three. Files are
the lower risk:

- `Resources/node` : the official Node 26 binary from nodejs.org for the target architecture.
  The Homebrew `node` on this machine is a 133 KB stub linked to a shared library and cannot be
  copied. About 110 MB on disk, 40 to 45 MB compressed (estimate).
- `Resources/app/engine/src`, `engine/node_modules` (production only, 125 MB on disk of which
  much is unused SDKs, perhaps 25 MB compressed; estimate), `board/config.yaml`, `board/agents`,
  `board/briefs`, `board/context`, `glhf/specialists`.
- A staging script copies these before `tauri build`, and **fails if a `.env` is among them**.
  `env.ts` would otherwise load it and ship someone's keys to every downloader.
- No engine dependency has a native module (no `.node` files; SQLite is Node's own), so nothing
  is compiled per platform except Node itself.

**Starting it.** In Rust, with `std::process::Command`, at startup. No shell plugin and no new
permission: the window still cannot start a process. First ask `GET /api/status` on 8787. If an
engine answers, use it and start nothing (a developer's own engine keeps working). If something
else holds the port, say so and stop. The dashboard's engine address is fixed at build time and
the content-security policy names port 8787, so a different port is not a quick change.

**Stopping it.** Keep the child handle. On the application's exit event send SIGTERM (the engine
handles it and releases its run locks, `server.ts`), wait a few seconds, then SIGKILL. If the app
crashes, the engine is left running; the next launch finds and reuses it, which is acceptable.
Benchmark runs are started detached on purpose (`glhf/task.ts`) and outlive the engine; the
drug board runs inside the engine and resumes on the next start (`app.resumePaused()`).

**Run folders.** This is the largest piece and it is engine work. `ROOT` in `engine/src/config.ts`
is the folder above `engine/`, and `board/runs`, `board/expertise`, `glhf/runs` and
`glhf/memory` are written under it. In an installed app that folder is inside the signed bundle:
writing there breaks the signature, fails outright when the app runs from a read-only location
(macOS runs a freshly downloaded app that way until it is moved), and is lost on every update.
The engine needs one new variable, for example `DRUG_BOARD_HOME`, with read-only material still
found from `ROOT` and everything written going to
`~/Library/Application Support/com.brendandang.aiscientistbot/`. About ten places use `ROOT` or a
path derived from it. `bixv1/store.ts` already does this with `BIXV1_RUNS_DIR`.

**Keys and `.env`.** There is no `.env` in a download. The app reads the keychain in Rust and
puts the keys in the child's environment when it starts the engine. A key never passes through
the window, as now. Needed:

- Exa (and optionally Hugging Face) added to the provider list in
  `keys.rs` and in Settings, each mapped to its variable name.
- A restart of the engine after a key is saved or removed, because mock mode is decided at
  start. The board resumes unfinished runs, so this is safe but must be said in the interface.
- A visible, deliberate "allow paid calls" switch that sets `NO_PAID_CALLS=0` for the child. It
  must default to off and say what it can spend. This replaces a safeguard that today requires
  editing a file by hand, so it deserves care and a second look.
- The Settings text that says the engine reads `.env` in the repo root has to change.

**Origin and content-security policy.** Nothing to do on macOS. The packaged window's origin is
`tauri://localhost`, already allowed by the engine, and the policy already allows
`http://127.0.0.1:8787` and `http://localhost:8787`. The release build proved both.

**Signing.** The app is signed with the hardened runtime. Node compiles code at run time, so the
bundled `node` needs entitlements (`com.apple.security.cs.allow-jit`,
`allow-unsigned-executable-memory`) in an entitlements file, or it is killed on start. This is a
known step with a known fix, but it only shows up in a signed release build, late.

**Hours (estimate).** Engine data folder 3 to 4; staging script and resources 1 to 2; start,
reuse and stop in Rust 2; keychain providers, environment hand-over, restart and the paid switch
2 to 3; entitlements and a test on a second Mac with no checkout 2 to 3.

**Risks.**
- The data-folder change touches the engine while other people are changing it.
- The paid switch moves a safety control into a button.
- A second machine is needed to test honestly. On this one a checkout, a `.env`, Node, uv and
  Docker are all present and will hide every missing piece.
- The board's computed-claim checker runs the `claude` command line tool. A downloader without
  it gets that checker's failure path; the other checkers are HTTP calls.
- The default view is the swarm scoreboard, which is empty and cannot start a run without uv and
  Docker. With (b) alone the first screen looks broken. The app should open on the board.

### (c) Sidecar plus first-run checks

As (b), and the app tells the person what is missing instead of failing later:

- The engine already knows: `GET /api/glhf/status` returns `tools: { docker, uv, gcloud }`, and
  `doctor()` in `engine/src/glhf/doctor.ts` has a one-line fix for each. Settings already shows
  them. The work is a first-run panel and gating: **drug board research enabled whenever the
  engine is up and the keys are set; benchmark and swarm runs disabled with the reason ("Docker
  is not running: start Docker Desktop", "uv is not installed: ...") until both are found.**
- The Python side is not in the download. Benchmark runs need `glhf/bixbench` (the harness
  source, then `uv sync`, about 575 MB of packages on this machine) and the gated dataset. So
  (c) either ships the harness source and runs `uv sync` into the data folder on first use, or
  says plainly that benchmark runs need a checkout. For a deadline, say it plainly.
- **The PATH problem.** An app started from Finder gets `/usr/bin:/bin:/usr/sbin:/sbin`. `uv`
  (in `~/.local/bin` or `/opt/homebrew/bin`), `docker` (`/usr/local/bin` or
  `/opt/homebrew/bin`) and `claude` are not on it, so the engine would report installed tools as
  missing. The app must add the usual folders, or ask the login shell for its PATH, before
  starting the engine. Without this the checks are wrong for exactly the people who did
  everything right. It also affects (b) for the `claude` checker.

Extra hours (estimate): PATH 1; first-run panel and gating in the dashboard 2 to 3; harness
decision and messages 1 to 2.

## 4. Recommendation

1. **Now, for the deadline: (a).** Publish the .dmg as a prerelease with the note above, and say
   in the submission that the desktop app is a window on a locally running engine. That is true
   and it is demonstrable today.
2. **Not before the deadline: (b).** It is the right next step and makes the claim "download
   it and do drug board research" true, but it is over ten hours, it needs engine changes and a
   second machine, and it changes how paid calls are switched on.
3. **After (b), (c) minus the bundled Python harness.** The checks are cheap because the engine
   has them; the PATH fix is required anyway.

If only a few hours are available and something beyond (a) is wanted, the piece of (b) worth
doing first is the engine's data folder (`DRUG_BOARD_HOME`). It is useful on its own (runs
outside the repo), it is testable without the app, and everything else in (b) waits on it.

## 5. Decisions needed

- Publish the prerelease now, with the command in section 1?
- Is an Apple Developer membership available? Without it every downloader goes through Open
  Anyway.
- Is "drug board from a download, benchmark runs from a checkout" an acceptable split for (b)?
- Who owns the paid-calls switch in the interface?

## 6. Not tested

- The Gatekeeper prompts. The wording in section 1 is what macOS documents for an app without a
  Developer ID; no quarantined copy was opened on this machine, and the "damaged" behaviour of a
  `--no-sign` build is from reports, not from a test here.
- Download through a browser, and install by drag to Applications. The app was run from the
  mounted disk image by its binary.
- Any machine but this one: Intel, an older macOS, a Mac without the repo, Windows.
- The keychain prompt in the release build, and clicking through any view but the first.
- Everything in (b) and (c), including the sizes, the entitlements and the hours.
