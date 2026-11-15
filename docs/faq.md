# Troubleshooting FAQ

Short answers to the problems people hit most when setting up and running AI Scientist Bot.
Read [README.md](../README.md) first — it defines the words used here.

## Contents

- [Setup](#setup)
- [Running the app](#running-the-app)
- [Demo vs Real mode](#demo-vs-real-mode)
- [Keys and spending](#keys-and-spending)
- [Still stuck](#still-stuck)

## Setup

**`npm run setup` fails.**
You need [Node.js](https://nodejs.org) 24 or newer and [uv](https://docs.astral.sh/uv/).
Check both:

```bash
node --version   # must be v24 or newer
uv --version
```

If Node is older, install a newer version. If `uv` is missing, install it from the link above,
then run `npm run setup` again. The setup step installs the engine, the dashboard, and the Python
side (`glhf/bixbench`), so all three must be installable.

**I do not want to install Node and uv.**
Use Docker instead. See the "Quick start with Docker only" section in
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Running the app

**Nothing shows at http://localhost:5317.**
The app has two parts. Start both, in the repository root, in two terminals:

```bash
npm run engine      # terminal 1
npm run dashboard   # terminal 2
```

Or start both at once with `npm start`. Open http://localhost:5317 after they report ready.

**"Port already in use" or it says it is using an engine it did not start.**
The engine uses port `8787` and the dashboard uses `5317`. If another process holds a port,
stop it (Ctrl+C in the terminal that owns it) or find and stop it:

```bash
lsof -i :8787
lsof -i :5317
```

When an engine is already running on `8787`, `npm start` reuses it and says so. It warns when
that engine runs code from another folder, or cannot say which code it runs — in that case stop
the old engine and start a fresh one from this folder.

**I pulled new code and things broke.**
Stop both terminals (Ctrl+C), then restart the app. After a `git pull` that changed
dependencies, run `npm run setup` again.

## Demo vs Real mode

**My answers are fixed example text, not real research.**
That is **Demo mode**, the default on a fresh clone. It is free, needs no account, and its answers
are canned examples that show how the app works. To get real research you must turn on Real mode
(next section).

**I turned on Real mode but a restart went back to Demo.**
Switching Run mode in **Settings** only lasts for that session. To stay in Real mode, set
`NO_PAID_CALLS=0` in `.env` and restart. See the "Turn on Real mode" section of the README.

## Keys and spending

**How do I check my keys without spending money?**
Run the preflight. It is free — it only asks each company for its model list and prints the
spending limits:

```bash
npm run preflight
```

**Which keys do I need for Real mode?**

| Key | Needed for |
|---|---|
| `ANTHROPIC_API_KEY` | Main AI models (writing, first check) |
| `OPENAI_API_KEY` | The critic and the second check |
| `EXA_API_KEY` | Web search |

The other keys in `.env.example` are optional. Keys are never stored in the repository — each
person uses their own, and a key alone spends nothing until someone turns on Real mode.

**A run stopped early with a message about a limit.**
That is expected. Each run and each day has a spending limit, set in `board/config.yaml`
(see the README for the current numbers). A run is stopped when it reaches its limit. A limit
that is not a number (for example `$5` with the dollar sign) stops the engine with a message
that names the key — fix the typo in `board/config.yaml`.

**Will tests or a coding agent spend money?**
No. `npm run check` forces paid calls off, and tests never spend.

## A quick self-check

Before reading further, run the helper. It is free and read-only — it checks Node, uv, installed
dependencies, your `.env` and run mode, and the two ports, then tells you what (if anything) to fix:

```bash
npm run troubleshoot
```

## Still stuck

- Run `npm run doctor` — it lists what your machine or container has and what is missing.
- Check what was actually tested in [docs/status.md](status.md).
- Read [docs/configuration.md](configuration.md) for every setting.
- See [docs/developers.md](developers.md) for every command and how the two parts fit together.
