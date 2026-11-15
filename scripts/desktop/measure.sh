#!/usr/bin/env bash
# Memory of a built app: app process, its WebKit helper processes and the engine, at idle after launch, after one finished
# practice run, and with the Graph view open (a relaunch on the same data: the view is chosen with ASB_START_VIEW).
# Usage: scripts/desktop/measure.sh "/private/tmp/.../AI Scientist Bot.app"   (no model is called)
# RSS is what `ps` reports; footprint is macOS's own figure (dirty + compressed pages, shared pages not double counted).
set -uo pipefail
APP="$1"; W=/private/tmp/asb-run-measure; rm -rf "$W"; mkdir -p "$W/home" "$W/tmp"
DATA="$W/home/Library/Application Support/com.brendandang.aiscientistbot"; H='Origin: tauri://localhost'
webkit() { ps -axo pid=,command= | grep -E "com.apple.WebKit.(WebContent|Networking|GPU)" | grep -v grep | awk '{print $1}' | sort -n; }
launch() { env -i HOME="$W/home" PATH=/usr/bin:/bin TMPDIR="$W/tmp" USER="$USER" ${1:+ASB_START_VIEW=$1} "$APP/Contents/MacOS/ai-scientist-bot" >>"$W/app.out" 2>&1 & }
wait_engine() { for _ in $(seq 1 120); do PORT=$(grep -o "127.0.0.1:[0-9]*" "$DATA/logs/engine.log" 2>/dev/null | tail -1 | cut -d: -f2); [ -n "$PORT" ] && curl -s -o /dev/null -H "$H" "http://127.0.0.1:$PORT/api/status" && return 0; sleep 0.25; done; return 1; }
mb() { awk -v k="$1" 'BEGIN{printf "%.1f", k/1024}'; }
fp() { footprint -p "$1" 2>/dev/null | awk '/Footprint:/{for(i=1;i<=NF;i++) if($i=="Footprint:"){v=$(i+1);u=$(i+2)}; if(u=="GB")v*=1024; if(u=="KB")v/=1024; printf "%.1f", v; exit}'; }
row() { # label pid
  local rss; rss=$(ps -o rss= -p "$2" 2>/dev/null | tr -d ' '); printf "  %-34s pid %-6s rss %7s MB   footprint %7s MB\n" "$1" "$2" "$(mb "${rss:-0}")" "$(fp "$2")"; }
report() { # title, set of webkit pids that existed before launch in $W/wk.before
  echo "== $1"; local app eng; app=$(pgrep -f "MacOS/ai-scientist-bot" | head -1); eng=$(pgrep -f "engine-app/node" | head -1)
  row "app (Rust shell)" "$app"; row "engine (node)" "$eng"
  local total=$(( $(ps -o rss= -p "$app" | tr -d ' ') + $(ps -o rss= -p "$eng" | tr -d ' ') )) p kind
  for p in $(webkit); do grep -qx "$p" "$W/wk.before" && continue
    kind=$(ps -o command= -p "$p" | grep -o "WebContent\|Networking\|GPU" | head -1); row "webview $kind" "$p"; total=$((total + $(ps -o rss= -p "$p" | tr -d ' '))); done
  echo "  processes of the app: $(( $(webkit | grep -vxFf "$W/wk.before" | wc -l) + 2 )) (shell, engine, webview helpers listed)   total rss $(mb $total) MB"; }
stop() { osascript -e 'tell application id "com.brendandang.aiscientistbot" to quit' >/dev/null 2>&1; sleep 3; echo "  after quit: app/engine processes left: $(pgrep -f 'MacOS/ai-scientist-bot|engine-app/node' | wc -l | tr -d ' '); webview helpers left: $(webkit | grep -vxFf "$W/wk.before" | wc -l | tr -d ' ')"; }

[ "$(pgrep -f 'MacOS/ai-scientist-bot|engine-app/node' | wc -l | tr -d ' ')" = 0 ] || { echo "quit a running app first"; exit 2; }
webkit > "$W/wk.before"
launch; wait_engine; sleep 25; report "idle on Home, 25 s after launch"
curl -s -H "$H" -H 'content-type: application/json' -d '{"messages":[{"role":"user","content":"Should we advance a KRAS G12C hit that has a hERG liability?"}]}' "http://127.0.0.1:$PORT/api/chat" > "$W/plan.json"
ID=$(python3 -c "import json;print(json.load(open('$W/plan.json'))['plan']['id'])"); curl -s -H "$H" -H 'content-type: application/json' -d '{"confirm":true}' "http://127.0.0.1:$PORT/api/chat/plans/$ID/start" >/dev/null
for _ in $(seq 1 90); do curl -s -H "$H" "http://127.0.0.1:$PORT/api/runs" | grep -q '"status":"done"' && break; sleep 1; done; sleep 15
report "idle on Home, after one finished practice run (15 s later)"
stop
launch Graph; wait_engine; sleep 25; report "Graph view open (relaunch on the same data, newest run loaded), 25 s after launch"
stop
