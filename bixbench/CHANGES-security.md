# Security changes to bixbench/ (2026-11-14)

A review ran a cell with a fake key on the code as merged. The cell printed
`ANTHROPIC_API_KEY`, read `~/.gitconfig` and a file outside both dirs, and
opened a TCP socket. By the same route a cell could have read the ideal
answers (HF cache, the capsule zip next to `DATA_DIR`, earlier repeats'
`result.json`) and the repo `.env`. Nothing stopped a paid run by accident.
Below: what changed, why, and what it means for your commands. The solve loop,
prompts, budget, logger and scoring logic are untouched.

## What changes for your commands

| Before | Now |
|---|---|
| `run.py ...` | Refused unless `NO_PAID_CALLS=0` (env, or a line in `.env`). `--budget-tokens` is required. |
| `regrade.py --results R` rewrote `R/**/result.json` | Refused unless `NO_PAID_CALLS=0`. Writes `R_regraded/` (or `--out`), originals untouched. Grades every question of each study, all runs (errored ones too), so `n_total` can be larger than before. |
| `selftest.py`, `summarize.py` | Unchanged. `python -m pytest tests` is new (38 tests, no key). |
| Linux | `run.py` stops with an explanation unless `--unsafe-no-sandbox`. |
| cells could use the network and `/tmp` | No network (gseapy Enrichr, downloads, `pip` fail). Temp files go to `work/.tmp`. `read_file`/`list_dir` no longer reach the host temp dir. |
| `data/<capsule>/` reused if non-empty | Reused only with the `.bixbase-prepared` marker. Your existing dirs have none, so each is unpacked again once from its zip (no download). |
| `Sandbox(...)` wrote `work/.seatbelt.sb` | No profile file. `Sandbox.profile` holds the text. New kwarg `unsafe_no_sandbox`. |

Old `results*/` on your disk still contain `ideal` in every `result.json`.
They are now unreadable from cells, but do not share or commit them.

## 1. Paid switch — `bixbase/paid.py` (new), `llm.py`, `run.py`, `regrade.py`
- `LLMClient.__init__` raises `PaidCallsOff` unless `NO_PAID_CALLS` is exactly
  `0`. That covers run.py, regrade.py, the judge and any direct use.
- Same rule, read order and wording as `glhf/bixbench/src/bixbench3/paid.py`
  (copied, because this folder has its own venv): process env, then the
  `NO_PAID_CALLS` line of the nearest `.env`, then of the repo `.env`. No value
  is printed.
- `run.py` and `regrade.py` call `enforce()` before `load_dotenv()`: while the
  switch is on the provider keys are set to empty, and `load_dotenv` does not
  overwrite a variable that is set. They exit 2 before loading data.
- `run.py --budget-tokens` is required and must be positive.
- Not changed: `--studies` still defaults to `all`. Say if you want that
  required too.

## 2. Cell environment — `sandbox.py` `Sandbox.cell_env`
Cells used to get `dict(os.environ)` after `load_dotenv`. Now they get exactly:
`PATH` (python's dir + `/usr/bin:/bin`), `HOME` = work dir, `TMPDIR` =
`work/.tmp`, `DATA_DIR`, `MPLBACKEND=Agg`, `LANG`, and `OMP_NUM_THREADS`
(yours if it is a number, else 4, as before). `MPLCONFIGDIR` is gone; with
`HOME` in the work dir matplotlib uses the same `work/.matplotlib`.

## 3. Sandbox profile — `sandbox.py` `build_profile`
The old profile was `(allow default)` with writes denied. The new one is
`(deny default)`; it is built per run and passed with `sandbox-exec -p`, not
written into the work dir (a cell could have edited that file for the next
cell). `<...>` are filled in at run time:

```
(version 1)
(deny default)
(allow process-fork)
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow ipc-posix-sem)
(allow ipc-posix-shm-read-data (ipc-posix-name "apple.shm.notification_center"))
(allow mach-lookup (global-name "com.apple.system.opendirectoryd.libinfo") (global-name "com.apple.system.notification_center"))
(allow process-exec
    (subpath "<venv>") (subpath "<base python install>")
    (subpath "/usr/bin") (subpath "/bin"))
(allow file-read-metadata            ; stat only: no listing, no contents
    (literal "<each parent folder of the readable dirs below>") ...
    (literal "/tmp") (literal "/var") (literal "/etc"))
(allow file-read*
    (subpath "<work dir>")
    (subpath "<prepared data dir>")
    (subpath "<venv>") (subpath "<base python install>")
    (subpath "/usr/lib") (subpath "/usr/share") (subpath "/usr/bin") (subpath "/bin")
    (subpath "/System/Library") (subpath "/System/Volumes/Preboot/Cryptexes")
    (subpath "/System/Cryptexes") (subpath "/Library/Apple") (subpath "/Library/Frameworks")
    (subpath "/Library/Developer/CommandLineTools/Library/Frameworks")
    (subpath "/Library/Developer/CommandLineTools/usr/lib")
    (subpath "/opt/homebrew/Cellar") (subpath "/opt/homebrew/opt")
    (subpath "/opt/homebrew/lib") (subpath "/opt/homebrew/Frameworks")
    (subpath "/usr/local/Cellar") (subpath "/usr/local/opt")
    (subpath "/usr/local/lib") (subpath "/usr/local/Frameworks")
    (subpath "/private/var/db/timezone") (subpath "/private/etc/localtime")
    (literal "<symlinks on the way to the python binary>") ...
    (literal "/") (literal "/dev/null") (literal "/dev/zero")
    (literal "/dev/random") (literal "/dev/urandom")
    (subpath "/dev/fd"))
(allow file-write*
    (subpath "<work dir>")
    (literal "/dev/null"))
(deny network*)
```

Print the real one: `Sandbox(data_dir, work_dir).profile`.

So a cell cannot read the capsule zip (it sits in `data/`, only
`data/<capsule>/` is allowed), the HF cache, `results*/` outside its own
`work/` (not even its own run's `transcript.jsonl`), the repo, `.env`, or
anything in your home folder. Symlinks, hard links and child processes do not
get around it (tested).

What a cell can still read: its work dir, the prepared data dir, the whole
venv and base Python install (so: installed package source; an editable
install or `.pth` pointing into the repo will not import), macOS system
libraries, Homebrew `Cellar/opt/lib`, the names in `/`. It can see that the
parent folders of those dirs exist (so your user name and the repo path), but
cannot list them. It can still fill the disk or burn CPU inside the timeout.

Off macOS there is no sandbox. `Sandbox(...)` raises `SandboxUnavailable`
with the reason; `run.py` checks before loading anything.
`--unsafe-no-sandbox` / `unsafe_no_sandbox=True` runs anyway, with the
allow-listed env but no file or network isolation.

## 4. No `ideal` in results — `run.py`, `regrade.py`
- `run.py` no longer writes `"ideal"` into `grades`. It grades as before from
  the in-memory `Study`. `summarize.py` never used the field.
- `regrade.py` reads ideals from the dataset at grade time, loops over the
  study's questions (missing answers are graded as `<no_answer>`, the same as
  run.py), and writes copies to a new tree that `summarize.py` reads as is.
  A row whose study is not in the dataset is skipped with a message.
- Not changed (yours to decide): in `run.py`, a question whose judge call
  raises is stored as `{"error": ...}` and left out of the metrics, which
  shrinks that run's denominator.

## 5. Data prep — `loader.py`
- `_prepare_zip` unpacks into `data/.prep-<name>-<pid>-<rand>/`, hoists
  `Data/*`, strips, writes `.bixbase-prepared` last, then renames to the final
  name in one step. One thread per target (lock); if another process wins the
  rename, its dir is used. A dir without the marker is moved aside and
  replaced, never used. Before, with `--workers`, a second repeat could get
  the dir while notebooks were still in it.
- `prepare_study_data` checks the zip first, and no longer returns the whole
  cache dir when `data_folder` is empty. A dir you unpacked by hand for a
  local `--data` source with no zip is still used as it is (nothing stripped).
- Stripped in addition to Notebook dirs and `*.ipynb`: `.rmd .qmd .html .htm
  .r .py .sh`, any case.
- What that removes in real capsules: I listed file names (names only) in the
  64 v1 capsule zips under `glhf/data/bixbench_v1/hub/`. Only `.ipynb` occurs:
  43 in Notebook dirs, 6 inside the Data dirs of 3 capsules (already removed
  by the old rule). No `.Rmd/.qmd/.html/.R/.py/.sh` anywhere, so the new
  suffixes remove nothing today. Not looked into: 119 nested `.zip` files and
  7 `.rds` (some named `res_*`) inside Data dirs; both stay, as in the
  official prep. The marker file is visible to the agent in `list_dir`.

## 6. `.gitignore`
`results/` became `results*/` (`results_gpt51/` was not ignored); `.pytest_cache/` added.

## 7. Docs — `AGENTS.md`, `bixbase/__init__.py`, `run.py`, `loader.py`
- Title and docstrings say BixBench v1. `loader.py` also looks for
  `BixBench.*` tables (the `bixbench3.*` names are kept).
- Removed "the swarm must reuse this infrastructure": the root `AGENTS.md`
  keeps the swarm on its own harness and upstream grader.
- Paid commands are marked and show the switch; rules for paid calls and
  ideal answers added.
- Your result numbers are kept, with the label asked for by the review.
- `__init__.py` named `grader.grade_study`, which does not exist; it now names
  `grade_answer` and `compute_metrics`.
- Not touched: `agent.py`'s docstring still says the swarm will reimplement
  `solve()`.

## 8. Licence — `LICENSE.md` (new)
The two grading prompts and `grader.py` come from Future-House/BixBench
(Apache-2.0). `LICENSE.md` has the attribution, what was modified, and the
licence text. Please check upstream's exact copyright line and whether it has
a NOTICE file; I had no web access.

## Tests
`python -m pytest tests` from `bixbench/` (add `pytest` to the venv). Scripted
model and fakes only; the switch is forced on; no `.env` is loaded.
- `test_selftest.py` runs `selftest.main()`
- `test_paid.py` item 1
- `test_sandbox.py` items 2, 3 (the seatbelt tests skip off macOS)
- `test_results.py` item 4
- `test_loader.py` item 5

Tested with Python 3.14.7 (the `glhf/bixbench` venv) and with a throwaway
3.14 venv built from your `requirements.txt`, where a sandboxed cell ran
pandas, openpyxl, matplotlib, statsmodels, scikit-learn, anndata/h5py,
pydeseq2, gseapy (import) and joblib. Not tested: your own `.venv`, a real
model run, a real capsule end to end, Linux.
