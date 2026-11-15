# Data scripts (`data-scrape` branch)

Helper scripts for **gathering data** for this project. Added on the `data-scrape`
branch — they don't change any app code.

There are two jobs these scripts do:

1. **Gather evidence** to back up the claims the agents make.
2. **Score** how good the agents are at answering science questions.

All downloaded data goes to `glhf/data/` and is gitignored (never committed).

---

## 1. Evidence corpus — `fetch_literature.py`

**What it does:** gathers evidence for a claim from several **trusted scholarly
databases** researchers use, merges and de-duplicates the results, and saves the
abstracts. A cached evidence base you can inspect, cite, or demo offline.

Sources (all free, no API key):

| Source | Covers |
|---|---|
| Europe PMC | PubMed / NIH (`ncbi.nlm.nih.gov`) + preprints — the source the app uses |
| OpenAlex | open scholarly catalog, ~all disciplines |
| Crossref | official DOI registry (every publisher) |
| Semantic Scholar | broad corpus with abstracts (may rate-limit without a key) |
| ClinicalTrials.gov | NIH clinical-trial records (`.gov`) |
| arXiv | preprints (physics / CS / quant bio) |

If a source is temporarily unavailable (e.g. Semantic Scholar returns 429), the
script skips it and keeps the others — one query still returns merged evidence.

```bash
python3 glhf/scripts/fetch_literature.py "KRAS G12C covalent inhibitor resistance"
python3 glhf/scripts/fetch_literature.py --file claims.txt          # one claim per line
python3 glhf/scripts/fetch_literature.py "crispr off-target" --sources europepmc openalex
```

Output: one Markdown file per query in `glhf/data/literature/` with the merged top
results (title, authors, venue, year, DOI/link, which source, abstract).

> Tip: use 3–6 PubMed-style keywords, not full sentences.
> Note: the app already does this live during a run — this is a cache/offline backup.

---

## 2. Score the agents — `fetch_eval_data.py` + `eval_adapter.py`

**What it does:** downloads science questions that have **known correct answers**,
shows them to a solver, and prints a score — proof of how good the agents are.

**One command (easiest):**
```bash
./glhf/scripts/demo.sh            # downloads sciq, runs it, prints a score
```

**Step by step:**
```bash
python3 glhf/scripts/fetch_eval_data.py sciq                      # download questions
python3 glhf/scripts/eval_adapter.py sciq --answerer oracle       # run + score
```

The "answerer" is who answers the questions:

| Answerer | What it is | Expected score |
|---|---|---|
| `oracle` | always picks the correct answer | ~100% (proves scoring works) |
| `random` | guesses | ~25% |
| `swarm` | **your real agents** | the real number — not wired up yet |

To get a real score, fill in `swarm_answers()` in `eval_adapter.py`.

Available question sets: `sciq`, `gpqa`, `pubmedqa`, `lab-bench`, `bixbench`
(`python3 glhf/scripts/fetch_eval_data.py --list`).

---

## Setup

```bash
# for the eval scripts only:
pip install "huggingface_hub>=0.23" "datasets>=2.19" pydantic
```
`fetch_literature.py` needs no install (standard library only).

---

## Files

| File | Job |
|---|---|
| `fetch_literature.py` | Gather PubMed/Europe PMC evidence to back up claims |
| `fetch_eval_data.py` | Download science-question datasets |
| `eval_adapter.py` | Run a solver on them and score it |
| `demo.sh` | One-command download + run + score |
| `fetch_research.py` | (Extra) background papers from arXiv about the method |
