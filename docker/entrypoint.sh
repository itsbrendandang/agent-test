#!/bin/sh
# Installs Linux builds of the dependencies into named volumes on first start, then runs the command.
# The repo is mounted at its host path, so host and container never share node_modules or .venv.
# Each install leaves the checksum of its lock file in the volume; when the lock file changes (after a
# `git pull`, for example) the next start installs again, so the volumes do not go stale.
set -e
sum() { sha256sum "$1" | cut -d' ' -f1; }

if [ -f engine/package-lock.json ]; then
  want=$(sum engine/package-lock.json)
  if [ ! -d engine/node_modules/@earendil-works ]; then
    echo "glhf: installing engine dependencies (first start only)..."
  elif [ "$(cat engine/node_modules/.glhf-lock 2>/dev/null)" != "$want" ]; then
    echo "glhf: engine/package-lock.json changed, installing engine dependencies again..."
  else
    want=""
  fi
  if [ -n "$want" ]; then
    npm ci --prefix engine --no-audit --no-fund >/dev/null
    echo "$want" > engine/node_modules/.glhf-lock
  fi
fi

if [ -f glhf/bixbench/uv.lock ]; then
  want=$(sum glhf/bixbench/uv.lock)
  if [ ! -x glhf/bixbench/.venv/bin/python ]; then
    echo "glhf: installing benchmark harness dependencies (first start only)..."
  elif [ "$(cat glhf/bixbench/.venv/.glhf-lock 2>/dev/null)" != "$want" ]; then
    echo "glhf: glhf/bixbench/uv.lock changed, installing benchmark harness dependencies again..."
  else
    want=""
  fi
  if [ -n "$want" ]; then
    # No cache: the packages are copied into the volume, and a cache in the container's own layer would
    # only double the disk use (about 700 MB) until the container is removed.
    (cd glhf/bixbench && UV_NO_CACHE=1 uv sync --locked --quiet)
    echo "$want" > glhf/bixbench/.venv/.glhf-lock
  fi
fi
exec "$@"
