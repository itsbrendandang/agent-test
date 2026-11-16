# Benchmark score improvements (proposal branch)

Three changes aimed at raising the deterministic BixBench3 artifact score (the 0.537).
All are small and reversible. **They have not been tested against the real benchmark** —
that needs the private HF/GCS data and spends money. Please A/B a few tasks before trusting them.

## How the score works (why these were chosen)

Final score = mean over the 20 tasks of each task's artifacts, where

```
artifact_score = F1(rows) x CCC(columns)   # a PRODUCT
```

So: a missing artifact = 0 (and it drags the mean), and both F1 (right row/identifier set)
and CCC (right numbers) must be high because they multiply.

## The three changes

1. **Completeness first** (`roles.py`, EXPERIMENTER)
   A real-but-partial artifact beats a missing one (0). The experimenter is now told to never
   leave a required output absent while time remains, and to disclose what is incomplete.
   The no-fabrication rule is kept and restated (fake values are still penalised).

2. **Match the output contract from the first write** (`roles.py`, EXPERIMENTER)
   Grading matches column names and the row-key/identifier set literally. A correct result in the
   wrong identifier type (e.g. gene symbol vs Ensembl ID) or with a renamed column grades as wrong.
   The experimenter now checks the contract as it writes, not only at review. Cheap F1 points.

3. **Rebalance the time budget toward the analysis** (`solver.py`)
   The deterministic grade is on the artifacts, not on the self-review/falsification track.
   - `FIRST_PASS_SHARE` 0.45 -> 0.50 (more time doing the analysis)
   - `FINISH_RESERVE`   0.05 -> 0.08 (more time rescuing missing artifacts at the end)
   - `AUDIT_SHARE`      0.10 -> 0.08
   - `CRITIQUE_SHARE`   0.30 -> 0.25

## How to test before trusting

Run a small slice both ways and compare the artifact score:
`main` (baseline) vs this branch, same model, same token cap, same capsules.
If this branch is not clearly better, revert the budget numbers first (change 3) — they are the
riskiest. Changes 1 and 2 are prompt-only and low risk.
