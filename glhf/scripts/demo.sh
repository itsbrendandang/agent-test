#!/usr/bin/env bash
# One-command demo of the eval-data scripts.
# Downloads a dataset and runs the grading pipeline with the built-in test answerers.
# No API keys needed.
#
#   ./glhf/scripts/demo.sh            # uses sciq
#   ./glhf/scripts/demo.sh gpqa       # try another dataset (see --list)

set -euo pipefail

DATASET="${1:-sciq}"
# Run from the repo root no matter where this is called from.
cd "$(dirname "$0")/../.."

echo "========================================"
echo " Eval-data demo  (dataset: $DATASET)"
echo "========================================"
echo
echo "WHAT THIS DOES:"
echo "  1. Downloads a set of science questions that already have known answers."
echo "  2. Hides the answers and shows each question to a 'solver'."
echo "  3. Compares the solver's answers to the correct ones and prints a score."
echo
echo "  This run uses built-in TEST solvers (no AI, no API keys):"
echo "    - oracle = always picks the correct letter  -> should score ~100%"
echo "    - random = guesses                          -> should score ~25%"
echo "  Those two numbers prove the scoring pipeline works. To get a REAL"
echo "  score, plug your model into swarm_answers() in eval_adapter.py."

echo
echo ">>> 1/4  Checking Python packages..."
python3 - <<'PY'
import importlib, sys
missing = [m for m in ("huggingface_hub", "datasets", "pydantic") if importlib.util.find_spec(m) is None]
if missing:
    print("  Missing:", ", ".join(missing))
    print('  Install with: pip install "huggingface_hub>=0.23" "datasets>=2.19" pydantic')
    sys.exit(1)
print("  OK")
PY

echo
echo ">>> 2/4  Downloading dataset..."
python3 glhf/scripts/fetch_eval_data.py "$DATASET" --sample 2 >/dev/null
echo "  Done -> glhf/data/$DATASET/"

echo
echo ">>> 3/4  oracle answerer (always correct -> proves scoring works):"
python3 glhf/scripts/eval_adapter.py "$DATASET" --limit 50 --answerer oracle --show 1

echo
echo ">>> 4/4  random answerer (guessing -> baseline, ~25%):"
python3 glhf/scripts/eval_adapter.py "$DATASET" --limit 50 --answerer random --show 0

echo
echo "Demo complete. If oracle is ~100% and random is ~25%, the pipeline works."
