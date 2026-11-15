#!/usr/bin/env bash
# Prove a built app stands on its own. Usage: scripts/desktop/verify.sh "/path/to/AI Scientist Bot.app" [label]
# Runs the app from where it is (copy it out of the repo first, to a real folder such as /private/tmp, not a symlinked one),
# with a clean environment (env -i: HOME, PATH without node, TMPDIR, USER only) and a throwaway HOME, so nothing of
# this machine's repo, Node or engine can be used. Calls no model. Needs a logged-in, unlocked Mac for the window check.
set -uo pipefail
APP="$1"; LABEL="${2:-verify}"
W="/private/tmp/asb-run-$LABEL"; HOME_DIR="$W/home"; rm -rf "$W"; mkdir -p "$HOME_DIR" "$W/tmp"
DATA="$HOME_DIR/Library/Application Support/com.brendandang.aiscientistbot"
H='Origin: tauri://localhost'; fail=0
ok() { echo "PASS  $*"; }; bad() { echo "FAIL  $*"; fail=1; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
procs() { pgrep -f "engine-app/node|MacOS/ai-scientist-bot" | wc -l | tr -d ' '; }
quit_app() { osascript -e 'tell application id "com.brendandang.aiscientistbot" to quit' >/dev/null 2>&1; sleep 3; }
launch() { env -i HOME="$HOME_DIR" PATH=/usr/bin:/bin TMPDIR="$W/tmp" USER="$USER" "$APP/Contents/MacOS/ai-scientist-bot" >>"$W/app.out" 2>&1 & }
wait_engine() { PORT=""; for _ in $(seq 1 120); do PORT=$(grep -o "127.0.0.1:[0-9]*" "$DATA/logs/engine.log" 2>/dev/null | tail -1 | cut -d: -f2); [ -n "$PORT" ] && curl -s -o /dev/null -H "$H" "http://127.0.0.1:$PORT/api/status" && return 0; sleep 0.25; done; return 1; }
api() { curl -s -H "$H" "http://127.0.0.1:$PORT$1" "${@:2}"; }

[ -x "$APP/Contents/MacOS/ai-scientist-bot" ] || { echo "no app at $APP"; exit 2; }
[ "$(procs)" = 0 ] || { echo "an app or engine is already running; quit it first"; exit 2; }
which node >/dev/null 2>&1 && echo "note: this shell has node at $(which node); the app is started with PATH=/usr/bin:/bin"
(cd "$APP" && find . -type f -print0 | xargs -0 shasum | shasum) > "$W/before.sha"; touch "$W/marker"; sleep 1
echo "node on the app's PATH: $(env -i PATH=/usr/bin:/bin sh -c 'command -v node || echo none')"

launch; wait_engine; check "engine answers on its own port (127.0.0.1:$PORT)" '[ -n "$PORT" ]'
check "engine listens on 127.0.0.1 only" '[ "$(lsof -nP -iTCP:$PORT -sTCP:LISTEN | awk "NR>1{print \$9}" | sort -u)" = "127.0.0.1:$PORT" ]'
check "window is open (1 visible window)" '[ "$(/tmp/asb-win 2>/dev/null | grep -c "onscreen: 1")" -ge 1 ] || { sleep 3; [ "$(/tmp/asb-win 2>/dev/null | grep -c "onscreen: 1")" -ge 1 ]; }'
talks() { for _ in $(seq 1 40); do lsof -nP -iTCP:$PORT 2>/dev/null | grep -q "ESTABLISHED" && return 0; sleep 0.25; done; return 1; }
check "the page's network process talks to that port" 'talks'
check "paid calls are off (/api/status paidCalls=false, no key present)" 'api /api/status | python3 -c "import sys,json;d=json.load(sys.stdin);sys.exit(0 if d[\"paidCalls\"] is False and not any(d[\"keys\"].values()) else 1)"'
check "catalogue loaded from the app's own engine (19 agents)" '[ "$(api /api/chat/catalog | python3 -c "import sys,json;print(len(json.load(sys.stdin)[\"agents\"]))")" = 19 ]'
check "it has none of the dev engine's runs (starts empty)" '[ "$(api /api/runs)" = "[]" ]'
check "foreign Origin refused (403)" '[ "$(curl -s -o /dev/null -w %{http_code} -H "Origin: http://evil.example" http://127.0.0.1:$PORT/api/status)" = 403 ]'
check "foreign Host refused (403)" '[ "$(curl -s -o /dev/null -w %{http_code} -H "Host: evil.example" http://127.0.0.1:$PORT/api/status)" = 403 ]'
paid_refused() { curl -s -o /dev/null -w '%{http_code}' -H "$H" -H 'content-type: application/json' -d '{"solver":"single","mode":"local","model":"anthropic/claude-sonnet-5-5","timeLimit":120,"maxTokens":50000}' "http://127.0.0.1:$PORT/api/glhf/runs"; }
check "a paid-model run is refused (400)" '[ "$(paid_refused)" = 400 ]'

api /api/chat -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"Should we advance a KRAS G12C hit that has a hERG liability?"}]}' > "$W/plan.json"
PID=$(python3 -c "import json;print(json.load(open('$W/plan.json'))['plan']['id'])" 2>/dev/null)
RID=$(api "/api/chat/plans/$PID/start" -H 'content-type: application/json' -d '{"confirm":true}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])" 2>/dev/null)
STATUS=""; for _ in $(seq 1 90); do STATUS=$(api /api/runs | python3 -c "import sys,json;r=json.load(sys.stdin);print(r[0]['status'] if r else 'none')"); [ "$STATUS" = done ] && break; sleep 1; done
check "a practice board run started from a plan finishes with a memo ($RID)" '[ "$STATUS" = done ] && api "/api/runs/$RID/memo" | grep -q "^# Memo"'
check "the run is stored under Application Support" '[ -f "$DATA/engine-root/board/runs/$RID/run.json" ]'
check "a swarm run (needs Docker/uv/Python) fails with a plain message" 'S=$(api /api/glhf/runs -H "content-type: application/json" -d "{\"solver\":\"glhf\",\"mode\":\"local\",\"model\":\"mock\",\"timeLimit\":120,\"maxTokens\":50000}"); sleep 6; api /api/glhf/runs | grep -q "could not be started"'

echo "second copy while the first runs:"; launch2() { env -i HOME="$HOME_DIR" PATH=/usr/bin:/bin TMPDIR="$W/tmp" USER="$USER" "$APP/Contents/MacOS/ai-scientist-bot" >"$W/second.out" 2>&1; }
launch2; check "second launch exits at once and starts no second engine" '[ "$(pgrep -f engine-app/node | wc -l | tr -d " ")" = 1 ] && grep -q "already running" "$W/second.out"'

quit_app; check "after quit: no app and no engine process (ps)" '[ "$(procs)" = 0 ]'
launch; wait_engine; check "after relaunch: the earlier run is still listed (new port $PORT)" 'api /api/runs | grep -q "$RID"'
kill -9 "$(pgrep -f MacOS/ai-scientist-bot | head -1)"; sleep 4
check "after kill -9 of the app: the engine stops by itself within 4 s" '[ "$(procs)" = 0 ]'
launch; wait_engine; check "app starts again after a crash (lock released, port $PORT)" '[ -n "$PORT" ]'; quit_app; check "clean again" '[ "$(procs)" = 0 ]'

check "nothing inside the app changed or was added" '[ "$( (cd "$APP" && find . -type f -print0 | xargs -0 shasum | shasum) )" = "$(cat "$W/before.sha")" ] && [ "$(find "$APP" -newer "$W/marker" | wc -l | tr -d " ")" = 0 ]'
check "nothing written at the HOME root outside Library" '[ "$(ls -A "$HOME_DIR")" = "Library" ]'
echo "data under: $DATA"; (cd "$DATA" && find . -maxdepth 3 -not -path "./engine-root/board/runs/*" | sort | head -30)
[ "$fail" = 0 ] && echo "ALL PASSED" || echo "SOME FAILED"; exit "$fail"
