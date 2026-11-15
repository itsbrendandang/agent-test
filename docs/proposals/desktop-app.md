# Proposal: a downloadable desktop app

Status: the unsigned macOS download in section 1 exists and was opened once. Options (b) and (c)
in section 3 are plans only; nothing in them has been built or run. Sizes and hours marked
"estimate" were not measured.

## 0. Short answer

**For the hackathon, ship option (a): the window as a download, the engine started separately.**
The .dmg is built (5.5 MB, Apple Silicon, ad-hoc signed, not notarised) and works against a
running engine.

**Do not start option (b) before the deadline.** It is about 10 to 14 hours, not 3, and it is
not low risk. Three things make it so, and none of them is in the desktop shell:

1. The engine writes run folders inside its own source tree. Inside an application bundle that
   is a read-only, signed place. The engine needs a separate data folder first (section 3b).
2. The engine reads keys only from environment variables and the repo's `.env`. The app's
   keychain commands store keys for four providers, and the two keys the drug board needs
   (OpenRouter and Exa) are not among them. Nothing hands a keychain key to the engine
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
| Every drug board model, and Jev | `OPENROUTER_API_KEY` | No |
| Board literature search | `EXA_API_KEY` | No |
| Jev directly (optional) | `TYPESAFE_API_KEY` | No |
| Board checker, benchmark judge | `OPENAI_API_KEY` | Yes |
| Swarm agents, Ask box | `ANTHROPIC_API_KEY` | Yes |
| Gated benchmark dataset | `HF_TOKEN` | No |
| Allow anything paid | `NO_PAID_CALLS=0` | Not a key; `.env` only |

Without `OPENROUTER_API_KEY`, or with paid calls off, the board runs on scripted models
(`mockMode` in `engine/src/config.ts`). That is decided once, when the engine starts.

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

- OpenRouter and Exa (and optionally Typesafe and Hugging Face) added to the provider list in
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
