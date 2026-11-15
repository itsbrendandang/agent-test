# Eval-data scripts

Two small scripts to **test how good our agent swarm is** at answering science
questions, using free public datasets.

## The idea in one line

Download a set of science questions that already have known answers → let our
agents answer them → count how many they got right.

## The two scripts

| Script | What it does | When you run it |
|---|---|---|
| `fetch_eval_data.py` | **Downloads** science-question datasets from Hugging Face onto your computer. | Once per dataset. |
| `eval_adapter.py` | **Runs** a solver on those questions and **scores** it against the known answers. | Every time you want a score. |

So: `fetch` = get the data, `adapter` = run the test.

## Setup (once)

```bash
pip install "huggingface_hub>=0.23" "datasets>=2.19" pydantic
```

## How to use it

```bash
# 1. See what datasets are available
python3 glhf/scripts/fetch_eval_data.py --list

# 2. Download one (goes into glhf/data/, which is gitignored)
python3 glhf/scripts/fetch_eval_data.py sciq

# 3. Test the pipeline with fake answerers (no API keys needed)
python3 glhf/scripts/eval_adapter.py sciq --limit 50 --answerer oracle   # ~100%
python3 glhf/scripts/eval_adapter.py sciq --limit 50 --answerer random   # ~25%
```

## The "answerers" (who answers the questions)

| Answerer | What it does | Why it exists |
|---|---|---|
| `oracle` | Always picks the correct answer. | Proves the scoring works (should be 100%). |
| `random` | Picks at random. | Baseline — ~25% for 4 options. |
| `always-a` | Always picks option A. | Sanity check. |
| `swarm` | **Our real agents.** | The one that matters — not wired up yet. |

To get a real score, implement `swarm_answers()` inside `eval_adapter.py`
(there's a commented sketch showing exactly where), then run with
`--answerer swarm`.

## Available datasets

| Key | What it is |
|---|---|
| `sciq` | Easy science multiple-choice. Cheap for quick tests/demos. |
| `lab-bench` | Research skills: reading papers, protocols, databases. Best fit for us. |
| `gpqa` | Hard graduate-level science. Needs a Hugging Face login + accepting terms. |
| `pubmedqa` | Biomedical yes/no/maybe questions. |
| `bixbench` | Our main benchmark (already used by `bixbench_v1`). |

## Why it fits the existing code

The adapter reuses the repo's own BixBench machinery, so a run here follows the
same rules as a real benchmark run:

- questions become the repo's `Question` objects,
- `public_view(...)` hides the correct answer from the solver and shuffles the
  options (same as a real run),
- `grade_answers(...)` does the scoring.

Nothing new or special — it just points the existing pipeline at extra datasets.

## Notes

- Downloaded data lives in `glhf/data/` and is **gitignored** — never committed.
- `sample.json` in each dataset folder lets you eyeball a few rows.
- These are **evaluation** datasets (questions + answers to grade against), not
  training data. Nothing here is uploaded into a model.
