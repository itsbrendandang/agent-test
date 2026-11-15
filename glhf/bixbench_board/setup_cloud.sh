#!/usr/bin/env bash
# Set up a Linux x86_64 machine to run the baseline and the board with R.
# Installs: bubblewrap (read-only data sandbox), uv + Python 3.11 venv from
# requirements.txt, micromamba + the pinned R env from r-environment.lock.txt.
# Then: export BIXBASE_RSCRIPT="$HOME/renv/bin/Rscript"
set -euo pipefail
cd "$(dirname "$0")"  # glhf/bixbench_board
R_ENV="${R_ENV:-$HOME/renv}"

sudo apt-get update -qq && sudo apt-get install -y -qq bubblewrap curl bzip2
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
uv venv -p 3.11 .venv
uv pip install -p .venv/bin/python -r requirements.txt

if ! command -v micromamba >/dev/null; then
  mkdir -p "$HOME/.local"
  curl -Ls https://micro.mamba.pm/api/micromamba/linux-64/latest \
    | tar -xj -C "$HOME/.local" bin/micromamba
fi
export MAMBA_ROOT_PREFIX="${MAMBA_ROOT_PREFIX:-$HOME/micromamba}"
micromamba create -y -p "$R_ENV" --file r-environment.lock.txt

"$R_ENV/bin/Rscript" -e 'suppressMessages({library(DESeq2); library(clusterProfiler); library(edgeR)}); cat("R OK\n")'
BIXBASE_RSCRIPT="$R_ENV/bin/Rscript" .venv/bin/python selftest.py
BIXBASE_RSCRIPT="$R_ENV/bin/Rscript" .venv/bin/python board_selftest.py
echo "Done. export BIXBASE_RSCRIPT=$R_ENV/bin/Rscript"
