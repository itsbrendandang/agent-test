# The hosted app on Modal

This folder puts the app on [Modal](https://modal.com) as one private web address. The owner and
the teammates open that address in a browser. Nobody has to run the engine on a laptop.

**State today: Stage 1. Demo mode only.** The hosted engine has no API key. It does practice
reviews and demo answers: fixed example text, not research. Real mode in the cloud is designed in
[REAL-MODE.md](REAL-MODE.md) and is not deployed.

| | |
|---|---|
| Address | Printed by the deploy command. Not written here, because this repository is public; the owner sends it with each access code. |
| Modal app | `asb-host` |
| Data | Modal Volume `asb-host-data` |
| Who may sign in | Modal Secret `asb-host-access`: hashes of access codes. It holds no API key. |
| Cost while nobody uses it | Nothing. The container stops after 5 minutes without a request. |

## What it is

One container. Inside it:

1. **The front door** (`front.mjs`, a small Node program). It is the only part that listens on
   the public port. It asks for sign-in, serves the built dashboard, and passes `/api/...` to the
   engine.
2. **The engine** (`node engine/src/server.ts`, unchanged). It listens on `127.0.0.1` inside the
   container only.
3. **The keeper** (`hosted.py`, `persist.py`). It starts both, and copies the run folders to the
   Volume.

The dashboard and the API have the same address. So the browser needs no cross-origin setting.

Why these choices:

- **The engine cannot serve files**, and we do not change engine code for hosting. So a small
  front door serves the dashboard and forwards the API.
- **One container at most** (`max_containers=1`). The engine keeps runs in its own memory and in
  files. Two engines on one data folder would both continue the same review.
- **Stops after 5 minutes** (`scaledown_window=300`). A stopped container costs nothing. The next
  request starts it again in 4 to 8 seconds.
- **Node 26.13.1**, the Node line the repository uses (`Dockerfile`), pinned to the patch the
  desktop app ships.

## Sign-in

Nothing is served without sign-in: not the app's files, not the API, not the event streams.
Modal's own protection (proxy tokens) needs a special request header, and a browser cannot send
one. So the front door has its own sign-in:

- Each person has a personal **access code** of 32 random characters.
- Modal stores only the SHA-256 of each code.
- After sign-in the browser holds a session cookie for 7 days. Scripts on the page cannot read it.
- A request to the API must come from the app's own page. A page on another site, also another
  `modal.run` app, is refused, with or without the cookie.

**What a teammate does:** open the address, paste the access code, press **Sign in**. A password
manager can keep the code. To sign out, open `/logout`.

**What the owner does to give access:**

```sh
python3 deploy/modal_host/access.py add ada          # makes a code for "ada"
cat deploy/modal_host/.local/codes/ada.txt            # the code: send it to Ada in private
python3 deploy/modal_host/deploy.py                   # the running app learns the new list
```

| Command | What it does |
|---|---|
| `access.py add <name>...` | A new code for each name. A name that exists gets a new code and loses its old sessions. |
| `access.py remove <name>...` | Takes a person out. |
| `access.py list` | Names and dates. Never a code. |
| `access.py sign-out-everyone` | Ends every session. The codes stay. |

The codes are in `deploy/modal_host/.local/` on the owner's machine. Git ignores that folder.
Never commit it.

The engine's own **session token** still guards everything that can cost money. In Demo mode
nothing can cost money, so nobody needs the token.

## Deploy

Needs the `modal` command (version 1.6 or later), logged in, and `git`.

```sh
python3 deploy/modal_host/access.py add owner         # once: at least one person
python3 deploy/modal_host/deploy.py                   # about 70 to 100 seconds
```

`deploy.py` copies the files the app needs to a temporary folder and builds from that copy. So
somebody editing the tree at the same moment cannot break the build. It prints what it built, for
example `building working tree at 8d3f1c4 with 34 changed files`. The same note is inside the
container as `/app/BUILD.json` and in the container's first log lines.

| Option | Meaning |
|---|---|
| (none) | The working tree as it is now, Demo mode. |
| `--from-head` | The last commit instead of the working tree. |
| `--label <name>` | The address becomes `https://<workspace>--<name>.modal.run`. A name that is hard to guess keeps strangers from finding the sign-in page. |
| `--real` | Real mode. **Only the person who pays runs this.** Read [REAL-MODE.md](REAL-MODE.md) first. |

Never copied into the image: `.env` files, `node_modules`, run folders, databases, tokens. The
image build fails if one of them is found. A Demo container that finds a provider key in its
environment refuses to start.

## Open, stop, delete

| To | Run |
|---|---|
| Open | The address, in a browser. The first page after a pause takes 4 to 8 seconds. |
| See the logs | `modal app logs asb-host` |
| Stop the app | `modal app stop asb-host` (the saved runs stay on the Volume) |
| Start it again | `python3 deploy/modal_host/deploy.py` |
| List what is saved | `modal volume ls asb-host-data /v1/board-runs` |
| Delete all saved runs | `modal app stop asb-host`, then `modal volume delete asb-host-data` |
| Delete the access list | `modal secret delete asb-host-access` |

## How runs are kept

A Modal Volume is not an ordinary disk. What a container writes is safe only after a *commit*, and
two files written one after the other can land in different commits. The engine keeps one SQLite
database per run in WAL mode. A commit that catches the database without its side file would give
a run that cannot be opened.

So the engine never writes to the Volume. It writes to the container's own disk. Every 5 seconds
the keeper looks for run folders that changed and saves each as a snapshot:

1. The engine is paused for about 10 milliseconds while the files are read. So the database, the
   event log and `run.json` are from the same instant.
2. The database is copied with SQLite's own backup call. That gives one complete file.
3. The run folder becomes **one file** on the Volume, `gen-<number>-<hash>.tar`. The name holds
   the SHA-256 of the bytes.
4. The Volume is committed. After that the older snapshot of that run is removed.

When a container starts, it takes the newest snapshot of each run whose bytes match the hash in
its name. A snapshot that was cut off is skipped and the one before it is used. Then the engine
starts and continues every review that was not finished.

What is saved: `board/runs` (reviews, plans, the search ledger, the paid-switch audit),
`board/runs/.research` (research answers), `board/expertise` (the members' notes) and `glhf/runs`
(the run tracker's database). The engine's session token is never saved.

**What can be lost:** if the container is killed with no warning, the last 5 seconds of a review
that was in progress. The review then continues from the last snapshot. A finished run is never
rewritten.

## Cost

Prices read from modal.com/pricing on 2026-11-14: CPU 0.00001314 USD per core per second, memory
0.00000222 USD per GiB per second, Volumes free up to 1 TiB. The container reserves 0.25 core and
0.5 GiB.

| Use | Cost |
|---|---|
| Nobody uses it | 0 |
| One hour of use | about 0.02 to 0.03 USD |
| Light use: 3 people, about 4 hours a day in total, 22 days | about 1.5 to 2.5 USD a month |
| Never idle (a tab left open on a review day and night, or a stranger's script hitting the address) | about 11 to 20 USD a month. This is the worst case. |

Spent on building and testing this: see [LEDGER.md](LEDGER.md).

## Limits

- **Demo mode only.** No real model, no web search, no key. Every answer says it is example text.
- **Swarm and benchmark runs do not work here.** They need a Docker sandbox, and Modal cannot run
  Docker inside a container. The app says so in plain words (HTTP 501). The Compare view is empty.
  The swarm's nine role descriptions do not load on the Agents page. Stage 3 changes this.
- **A stop in the middle of a review** costs up to 5 seconds of that review's progress. It is
  continued at the next visit. The event log then holds the `run.roster` and the current
  `round.started` event twice (the engine writes them again when it continues).
- **A review runs only while the container is up.** The container stops 5 minutes after the last
  request. A practice review takes seconds, so this does not matter in Demo mode. It matters in
  Real mode (see REAL-MODE.md).
- **A request that arrives in the seconds while a container is being replaced can get HTTP 500**
  from Modal. Reload the page.
- **Modal may replace the container at any time** (preemption). It happened once during testing,
  in the middle of a review. The review continued in the new container.
- **One shared data folder.** Every signed-in person sees every run. There are no private runs.
- **The engine's session token changes at every container start.** Nobody needs it in Demo mode.
- Closing an event stream writes a harmless error trace from Modal's own proxy into the logs.

## Files

| File | What it is |
|---|---|
| `app.py` | The Modal app: image, container settings, start and stop. |
| `deploy.py` | Deploys from a frozen copy of the tree. |
| `access.py` | Access codes and the access Secret. |
| `front.mjs` | The front door: sign-in, static files, pass-through to the engine. |
| `hosted.py` | Starts the engine and the front door, runs the snapshot loop. |
| `persist.py` | Snapshot and restore of the run folders. |
| `tests/` | `test_persist.py`, `test_hosted.py`, `front.test.mjs` (local, no network); `cloud_check.py`, `browser_check.mjs` (against the deployed app). |
| `REAL-MODE.md` | The design for Real mode in the cloud, the threat list, open models. |
| `LEDGER.md` | What was deployed, for how long, and what it cost. |

## Tests

```sh
cd deploy/modal_host
uv run --with pytest python -m pytest -q tests          # 30 tests: persistence, start and stop, a hard stop in mid-review
node --test tests/front.test.mjs                         # 13 tests: sign-in, refusals, pass-through
python3 tests/cloud_check.py <address> refused           # every path without a session is refused
python3 tests/cloud_check.py <address> demo              # the engine is in Demo, locked, with no key
python3 tests/cloud_check.py <address> features          # chat, plan, review, research answer, search
NODE_PATH=/tmp/pptr/node_modules node tests/browser_check.mjs <address>   # a real browser (needs puppeteer-core in /tmp/pptr)
```

The cloud checks sign in with the code of the person named in `ASB_CHECK_USER` (default
`owner`). They start practice reviews only.

Do not name a file or a folder `modal`. It would hide the Python package of that name.
