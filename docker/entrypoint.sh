#!/bin/sh
# Installs Linux builds of the dependencies into named volumes on first start, then runs the command.
# The repo is mounted at its host path, so host and container never share node_modules or .venv.
set -e
if [ -f engine/package.json ] && [ ! -d engine/node_modules/@earendil-works ]; then
  echo "glhf: installing engine dependencies (first start only)..."
  npm ci --prefix engine --no-audit --no-fund >/dev/null
fi
if [ -f glhf/bixbench/pyproject.toml ] && [ ! -x glhf/bixbench/.venv/bin/python ]; then
  echo "glhf: installing benchmark harness dependencies (first start only)..."
  (cd glhf/bixbench && uv sync --locked --quiet)
fi
exec "$@"
