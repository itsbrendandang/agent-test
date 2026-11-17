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
| Europe PMC | PubMed / NIH (`ncbi.nlm.nih.gov`) + preprints |
| OpenAlex | open scholarly catalog, ~all disciplines |
| Crossref | official DOI registry (every publisher) |
| Semantic Scholar | broad corpus with abstracts (set `S2_API_KEY` to avoid rate limits) |
| ClinicalTrials.gov | NIH clinical-trial records (`.gov`) |
| bioRxiv / medRxiv | biology & medicine preprints |
| DOAJ | Peer-reviewed open-access articles |
| DataCite | Research datasets and software |
| arXiv | preprints (physics / CS / quant bio) |

If a source is temporarily unavailable (e.g. Semantic Scholar returns 429), the
script skips it and keeps the others — one query still returns merged evidence.

Semantic Scholar's keyless API is heavily throttled. For reliable results, get a
free key from semanticscholar.org and set it before running:
```bash
export S2_API_KEY=your_key_here
```

```bash
python3 glhf/scripts/fetch_literature.py "KRAS G12C covalent inhibitor resistance"
python3 glhf/scripts/fetch_literature.py --file claims.txt          # one claim per line
python3 glhf/scripts/fetch_literature.py "crispr off-target" --sources europepmc openalex
```

Output: one Markdown file per query in `glhf/data/literature/` with the merged top
results (title, authors, venue, year, DOI/link, source, **citation count**, abstract).
Add `--json` to also write a machine-readable `.json` the app/agents can read.

```bash
python3 glhf/scripts/fetch_literature.py "crispr off-target" --json   # also save JSON
```

**How results are ranked:** papers with abstracts first, then **most-cited**, then
newest — so the most trusted sources are at the top. All sources are queried **in
parallel**, so one query finishes in a few seconds.

> Tip: use 3–6 PubMed-style keywords, not full sentences.

The script queries all nine sources by default. It saves a cache for offline use; the app does not read it.
The app's research answers search six literature sources: Europe PMC, OpenAlex, Semantic Scholar,
arXiv, Crossref and bioRxiv/medRxiv (`engine/src/search/scholarly.ts`). A team review's
`literature_search` uses Europe PMC (`engine/src/search/literature.ts`). These are separate searches,
not the script's nine-source search or its citation ranking.

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
| `claude` | **your model (Claude)** answers each question | the real number |
| `openai` | **your model (GPT)** answers each question | the real number |
| `swarm` | the full Docker/Modal agent swarm | real number — needs wiring in `swarm_answers()` |

### Test with your model (Claude or GPT)

1. Put your key in a `.env` file at the repo root (it is gitignored — never committed):
   ```bash
   cp .env.example .env     # then edit .env and paste your key:
   # ANTHROPIC_API_KEY=sk-ant-...
   # OPENAI_API_KEY=sk-...
   ```
2. Run:
   ```bash
   python3 glhf/scripts/eval_adapter.py sciq --limit 20 --answerer claude
   python3 glhf/scripts/eval_adapter.py sciq --limit 20 --answerer openai
   python3 glhf/scripts/eval_adapter.py sciq --answerer claude --model claude-3-5-haiku-20241022
   ```

The `claude` and `openai` answerers are paid calls. They refuse unless the person who pays
sets `NO_PAID_CALLS=0` (the project's paid-calls switch, `refuse_paid()`). The other answerers
are free and always work. Test: `glhf/bixbench_v1/tests/test_eval_adapter_paid.py`.

This is the quick "one model call per question" test. The full multi-agent swarm
is wired via `swarm_answers()` in `eval_adapter.py`.

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
