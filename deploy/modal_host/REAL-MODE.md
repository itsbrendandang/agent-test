# Real mode in the cloud: design, threat list, open models

**State: designed, partly coded, not deployed.** No key Secret was created and no real model was
called. What exists in code today is marked "built"; the rest is Stage 2 work.

## 1. How it would work

| | |
|---|---|
| Keys | ONE Modal Secret named `asb-keys`: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `EXA_API_KEY`, optional `HF_TOKEN`, `PAST_API_KEY`. Only the owner creates it. No agent creates, reads or prints it. |
| Deploy flag (built) | `python3 deploy/modal_host/deploy.py --real` attaches `asb-keys`. Without the flag no key Secret is attached. |
| Engine start (built, tested with fake keys) | Also in real mode the engine starts with `NO_PAID_CALLS=1`: it boots in **Demo**. The switch is not locked. The engine's environment is built from nothing: it gets the five keys above and nothing else of the container. The front door never gets a key. |
| Demo deployment with a key by mistake (built, tested) | The container refuses to start. |
| Turning Real on | A person signs in, opens the Demo/Real switch, pastes the engine's **session token**, and types the confirmation. This is the engine's own rule (`engine/src/paidswitch.ts`); the cloud adds nothing to it and removes nothing. Every change is written to the audit file, which is saved on the Volume. |
| Where the session token is | In a file inside the running container (`/app/glhf/runs/.token`, mode 600). It is never on the Volume, never in the logs, never sent over the web, and not in git. The owner reads it with the Modal CLI (Stage 2 adds a one-line helper around `modal container exec <id> -- cat /app/glhf/runs/.token`). |
| Going back to Demo | The engine keeps "Real" in memory only. A new container starts in Demo with a new token. In the cloud a container ends 5 minutes after the last request, so **Real ends by itself when the app is idle**. This is the safe direction and should stay. |

Two things Stage 2 must add and test before real mode is usable:

1. **Keep the container up while a real review runs.** Modal counts requests, not work. A real
   review (up to 15 minutes) started by a person who then closes the tab would be cut at 5 idle
   minutes, and the new container starts in Demo, where a real review stays paused. The keeper
   must hold the container while a run is in progress (a blocking call on its own class is the
   Modal-native way) and release it when the run ends.
2. **Prove the spend records survive a restart.** "Spent today" is computed from `run.json` of
   every review and from the answer records, all under `board/runs`, which is on the Volume. A
   snapshot is at most 5 seconds old, so a hard kill can lose at most the last 5 seconds of
   recorded spend. To be tested with fake keys and a fake vendor server.

## 2. The caps that would apply

From `board/config.yaml` and the engine, unchanged by hosting:

| Cap | Value | Where |
|---|---|---|
| One team review | 5 USD, 15 minutes, 4 rounds | `meeting.max_usd`, `max_minutes`, `max_rounds` |
| One research answer | 0.15 USD (quick), 0.60 USD (standard), 120 seconds | `research:` block |
| All reviews and answers of one day | 20 USD. A review in progress counts at its full cap. | `meeting.daily_usd` |
| Exa search, lifetime | 40 USD | `meeting.exa_ceiling_usd`, ledger in `board/runs/.exa-ledger.jsonl` |
| Ask (search over saved runs) with a model | 200 model calls a day, then keyword answers | `ASK_DAILY_CAP` |
| Swarm and benchmark runs | Not available in the hosted app (Stage 3) | |

The "day" is the container's day, which is UTC.

## 3. Threat list

| Who | What they can do | What they can spend |
|---|---|---|
| A person with the address and no access code | Get the sign-in page and HTTP 401 for every path (tested: 224 requests, files, API, event streams, every method). Wake the container: each request keeps it up for 5 minutes. | No API money. Modal CPU at most about 0.4 to 0.7 USD a day if a script never stops. A hard-to-guess `--label` avoids even that. |
| A teammate with an access code and no session token | Use the app in Demo. Read every saved run, also real ones. Start practice reviews (free; they use Volume space). Read the engine status (which keys are present: yes or no, never a key). | Nothing: every route that can spend asks for the session token and answers 401 without it (the engine's `gate`, need "spend"). The front door passes the token header through and never adds one. To be re-tested through the front door with fake keys in Stage 2. |
| A person with an access code and the session token | Turn Real on (with the confirmation text), start real reviews and answers, turn it off. | The caps of section 2: 20 USD a day for reviews and answers together, plus up to 200 small Ask calls a day, plus Exa inside its 40 USD lifetime ceiling. The chat's own model call is rate-limited but has no dollar cap of its own in the engine: check its size before real use. |
| An attacker who steals a session cookie or an access code | The same as a teammate without the token. | Nothing, for the same reason. Remove the person with `access.py remove`, or end all sessions with `access.py sign-out-everyone`, then deploy. |
| An attacker who also has the session token | The same as the row above it. The token lives in one container and dies with it. | The daily caps, until the container stops or someone switches back to Demo. |
| A member of the Modal workspace | Everything: read the Secret, the Volume, the token, deploy anything. | No limit from this design. **Do not add teammates to the Modal workspace** only so that they can use the app; the access code is for that. |
| Another app on `modal.run` (same site, different origin) | Its pages are "same-site" for the browser, so `SameSite` cookies do not stop them. The front door refuses every API request whose `Sec-Fetch-Site` is not `same-origin` or whose `Origin` is not this address (tested in a real browser from another site). The cookie has the `__Host-` prefix, so no other host can set it. | Nothing. |

What limits the damage that the engine cannot: the vendors' own limits. Set a monthly limit on
the Anthropic, OpenAI and Exa keys used here.

## 4. Recommendation

1. Keep the hosted app in Demo until there is a reason to pay from the cloud. Real research can
   still be run from the owner's machine as today.
2. If real mode is wanted: make **separate keys** for the hosted app, each with a monthly limit
   at the vendor, and put only those in `asb-keys`. Then a leak or a mistake has a hard ceiling,
   and the keys can be revoked without touching the local setup.
3. Only the owner holds the session token and switches Real on. Teammates ask.
4. Deploy with a `--label` that is hard to guess, and keep teammates out of the Modal workspace.
5. Before the first real run from the cloud, lower `meeting.daily_usd` for a first week, and do
   one real review with `max_usd` 0.5.

## 5. A board on an open model served on Modal

Facts from the agent `modal-bench` (2026-11-15; details in `glhf/openmodels/`):

- One model is smoke-tested with working tool calls: `Qwen/Qwen3.6-35B-A3B-FP8` on one L40S GPU,
  0.000665 USD per second (2.40 USD an hour with its CPU and memory), 105 output tokens a second,
  context 131,072 tokens, 16,384 output tokens a reply.
- The address has the form `https://<workspace>--<app-name>-server.us-east.modal.direct/v1`
  (OpenAI Chat Completions). Read it with `modal server info <app-name>/Server --json`.
- It is protected by a Modal **proxy token** sent as `Authorization: Bearer wk-<id>.ws-<secret>`.
  A refused request does not wake the GPU. The hosted engine would need its own proxy token
  (`modal workspace proxy-tokens create`), held in a Secret.
- The model app is **stopped between uses**. Someone deploys it first; the first answer comes
  after about 5 minutes; a request during the start gets HTTP 503 and must be tried again. It
  stops 5 minutes after the last request.

What the engine can do today (read from `engine/src/config.ts` and `engine/src/local.ts`; the agent
`local-model` was asked and had not answered when this was written):

- The board can run all its members on a "local" model id (`ollama/<name>`, address from
  `LOCAL_MODEL_URL`). An address on another machine is refused unless `LOCAL_MODEL_ALLOW_REMOTE=1`.
- In such a run **only the members' text is real**. The search returns the example sources and
  the statement checks are scripted. So today it would not be a checked review.
- Not verified: whether the engine can send a bearer key to that address, and whether a model id
  with a slash in its name works.

What "a review that costs only GPU time plus the free literature search" still needs, in the
engine (not in this folder): (1) a bearer key for the model address; (2) a mode in which the free
literature search (Europe PMC) is real while Exa stays off; (3) a real first-pass checker on the
open model, with a plain statement that the checker and the member are then the same model, which
weakens the "checked by another vendor" rule; (4) GPU seconds counted against `max_usd` and
`daily_usd`, because GPU time is money (it is not a "free local model"); (5) retries during the
model's cold start.

Rough cost of one such review, an estimate: 5 minutes cold start + up to 15 minutes of review +
5 minutes before the GPU stops = up to 25 minutes = about 1.00 USD if it is the only review in
that window; several reviews in a row share the start and the tail. Not measured.
