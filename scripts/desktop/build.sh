#!/usr/bin/env bash
# Build the self-contained macOS app: AI Scientist Bot.app and its .dmg, with Node and the engine inside.
#   scripts/desktop/build.sh            build from the working tree
#   DASHBOARD_FROM=head scripts/desktop/build.sh   build the dashboard from the last commit (use when dashboard/src does not compile)
# Output: dashboard/src-tauri/target/artifacts/step2/. Needs Rust (rustup), Node and npm on the BUILD machine only.
# Never reads .env, never calls a model. Fails if a key, a .env or a run folder would end up in the bundle.
set -euo pipefail

NODE_VERSION=26.13.1
NODE_SHA256=aec2514ea1ceb2ba52455e9ec65986f6749a06dd759e5db2a72e6889668c9735
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TAURI="$ROOT/dashboard/src-tauri"
TARGET="${CARGO_TARGET_DIR:-$TAURI/target}"
STAGE="$TAURI/target/stage"
CACHE="$TAURI/target/desktop-cache"
OUT="$TARGET/artifacts/step2"
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"

[ "$(uname -s)-$(uname -m)" = "Darwin-arm64" ] || { echo "build on an Apple Silicon Mac" >&2; exit 1; }
started=$(date +%s)

# 1. Node: the official build, checked against a pinned checksum before it is used.
mkdir -p "$CACHE"
TARBALL="$CACHE/node-v${NODE_VERSION}-darwin-arm64.tar.gz"
[ -f "$TARBALL" ] || curl -fsSL "$NODE_URL" -o "$TARBALL"
echo "$NODE_SHA256  $TARBALL" | shasum -a 256 -c - >/dev/null || { echo "Node checksum mismatch: delete $TARBALL" >&2; exit 1; }
[ -d "$CACHE/node-v${NODE_VERSION}-darwin-arm64" ] || tar -xzf "$TARBALL" -C "$CACHE"
NODE_DIR="$CACHE/node-v${NODE_VERSION}-darwin-arm64"
codesign --verify --strict "$NODE_DIR/bin/node"   # the vendor's own signature must be intact

# 2. Stage what goes inside the app.
rm -rf "$STAGE"; APP="$STAGE/engine-app"
mkdir -p "$APP/engine" "$APP/board" "$APP/glhf" "$APP/skills"
cp "$NODE_DIR/bin/node" "$APP/node"
cp "$NODE_DIR/LICENSE" "$APP/NODE-LICENSE"
cp "$ROOT/scripts/desktop/watchdog.mjs" "$APP/watchdog.mjs"
cp -R "$ROOT/engine/src" "$ROOT/engine/package.json" "$ROOT/engine/package-lock.json" "$APP/engine/"
(cd "$APP/engine" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null)
# Trim what the running engine never reads: source maps, type declarations, docs, test folders, command-line stubs.
# Licence and notice files stay. This is a size and memory measure only: the code that runs is untouched.
(cd "$APP/engine/node_modules" && find . \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -iname 'README*' -o -iname 'CHANGELOG*' -o -iname 'HISTORY*' \) -type f -delete \
  && find . -name '*.md' ! -iname 'licen*' ! -iname 'notice*' -type f -delete && rm -rf .bin && find . -type d \( -name test -o -name tests -o -name __tests__ -o -name docs -o -name examples \) -prune -exec rm -rf {} +)
for f in config.yaml agents context briefs; do cp -R "$ROOT/board/$f" "$APP/board/$f"; done
# Only the profiles the catalogue reads (top-level .md): no scripts, no skills/ folder.
mkdir -p "$APP/glhf/specialists" && cp "$ROOT"/glhf/specialists/*.md "$APP/glhf/specialists/"
for d in "$ROOT"/.agents/skills/*/; do mkdir -p "$APP/skills/$(basename "$d")"; cp "$d/SKILL.md" "$APP/skills/$(basename "$d")/"; done
find "$APP" -name .DS_Store -delete

# 3. Guards: nothing private in the bundle.
if find "$APP" \( -name '.env' -o -name '.env.*' -o -name '*.sqlite*' -o -name '.token' -o -name '.exa-ledger.jsonl' -o -name 'run.json' \) | grep -q .; then
  echo "refusing to bundle: a .env, database, token or run file is in the stage" >&2; exit 1; fi
if grep -rIlE '(sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16}|exa-[0-9a-f-]{30,})' "$APP" --exclude-dir=node_modules | grep -q .; then
  echo "refusing to bundle: something that looks like an API key is in the stage" >&2; exit 1; fi
# The only program in the bundle must be Node. Any other Mach-O (a native module) would need signing too.
others=$(find "$APP" -type f -not -path "$APP/node" -exec file {} + | grep -c 'Mach-O' || true)
[ "$others" = 0 ] || { echo "a native binary other than node is in the bundle; it needs signing" >&2; exit 1; }

# 4. The dashboard, built to call a placeholder address. The window rewrites it to the engine's real port.
if [ "${DASHBOARD_FROM:-tree}" = head ]; then
  SRC="$STAGE/dashboard-src"; mkdir -p "$SRC"; (cd "$ROOT" && git archive HEAD dashboard) | tar -x -C "$SRC"
  ln -s "$ROOT/dashboard/node_modules" "$SRC/dashboard/node_modules"; DASH="$SRC/dashboard"
else DASH="$ROOT/dashboard"; fi
(cd "$DASH" && VITE_ENGINE_URL=http://engine.localhost npm run build >/dev/null)
rm -rf "$STAGE/dist"; cp -R "$DASH/dist" "$STAGE/dist"

# 5. A config that adds the bundled files and lets the page reach the engine's port (127.0.0.1 only).
node -e '
const fs = require("fs"), base = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
const csp = { ...base.app.security.csp, "connect-src": base.app.security.csp["connect-src"].replace(/ http:\/\/127\.0\.0\.1:8787 http:\/\/localhost:8787/, " http://127.0.0.1:*") }
fs.writeFileSync(process.argv[2], JSON.stringify({
  build: { frontendDist: process.argv[3], beforeBuildCommand: "" },
  app: { security: { csp } },
  bundle: { resources: { [process.argv[4]]: "engine-app" } },
}, null, 2))' "$TAURI/tauri.conf.json" "$STAGE/tauri.override.json" "$STAGE/dist" "$APP"

# 6. Build and ad-hoc sign (Tauri signs the app; node keeps the Node.js Foundation signature it came with).
(cd "$ROOT/dashboard" && ASB_BUNDLED_ENGINE=1 nice npx tauri build --config "$STAGE/tauri.override.json" --bundles app,dmg)

mkdir -p "$OUT"; rm -rf "$OUT"/*
cp -R "$TARGET/release/bundle/macos/AI Scientist Bot.app" "$OUT/"
cp "$TARGET"/release/bundle/dmg/*.dmg "$OUT/"
echo "built in $(( $(date +%s) - started )) s: $OUT"; ls -l "$OUT"
