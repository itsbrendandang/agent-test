## What changed and why

<!-- One or two sentences. If you report a result, say what was run: which case, which model,
     scripted or real, how many runs (docs/status.md). -->

## Checks

- [ ] `npm test` passes on my machine (CONTRIBUTING.md section 5).
- [ ] If I changed `glhf/bixbench_v1/`: `cd glhf/bixbench_v1 && uv run pytest -q tests` passes.
- [ ] If I changed `dashboard/`: `npm run build` and `npm run lint` pass in `dashboard/`.
- [ ] The change is complete: every new file is imported or tested, and nothing imports a file
      that is not in this pull request.

## Not in this pull request (CONTRIBUTING.md section 7)

- [ ] No `.env` and no key.
- [ ] No run folder (`glhf/runs/`, `glhf/bixbench/runs/`, `glhf/bixbench_v1/runs/`, `board/runs/`).
- [ ] No benchmark data, no benchmark answers, no file over 5 MB.
- [ ] No change to the grader (`glhf/bixbench/src/bixbench3/grading/`) or to the upstream
      solver (`glhf/bixbench/src/bixbench3/inspect_harness/solvers.py`).
- [ ] No result, score or answer in `glhf/memory/lessons.md` or `lessons.pending.md`.
