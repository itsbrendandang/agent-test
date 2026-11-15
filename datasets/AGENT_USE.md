# How agents may use the dataset catalogue

This note is a proposal for the team. **Nothing is wired.** No code in `engine/`, `dashboard/`,
`glhf/` or `board/` reads this folder today.

The catalogue (`catalog.jsonl`) is a list of pointers: name, address, licence, how we found it.
It holds no data.

## The four rules

| # | Rule | Why |
|---|---|---|
| 1 | **Lookup only.** An agent may read the catalogue to find out which datasets exist and under which licence. The catalogue is not evidence for a claim. | A description is one or two lines from the provider or from us. It was not checked as a scientific statement. |
| 2 | **Never in a benchmark run.** Agents that solve BixBench or BixBench3 tasks get no catalogue: not in the prompt, not as a tool, not as a file in the sandbox. | See "The benchmark boundary" below. |
| 3 | **Downloads go only into a sandbox data folder**, through one tool, after the checks in "A download tool" below. Never into the repository. | Data files are large, have licences, and must be traceable to a run. |
| 4 | **A person decides** when the licence is `unknown`, `commercial_use` is `unclear` or `no`, `access` is `registration`, or the download costs money. | The catalogue reports what the source says. It is not legal advice. |

## Who may read the catalogue

| Agent | May read it? |
|---|---|
| Drug board agents (lead scientist, research agents) on a research question | Yes, as a lookup. |
| Home chat planner, when it proposes a plan | Yes, to name candidate datasets in the plan. The person confirms the plan. |
| Swarm roles on a BixBench3 task (`--solver glhf`), single agent (`--solver single`) | **No.** |
| BixBench v1 adapter roles (analyst, critic, reconciler) | **No.** |
| The benchmark's judge or grader | No. It does not need it. |

## The benchmark boundary

The benchmark tasks ask an agent to reproduce a published study from its raw data. A catalogue of
public datasets is a way to find that study. So:

- Do not add the catalogue, or any host named in it, to `DOC_DOMAINS` in
  `glhf/bixbench/src/bixbench3/inspect_harness/swarm/tools.py`. The rule in the root `AGENTS.md`
  already forbids data repositories there.
- Do not mount `datasets/` into a benchmark sandbox and do not copy it into a case folder.
- Do not put catalogue text into `glhf/memory/lessons.md`.

What the catalogue does to stay away from benchmark studies (all three are rules in
`scripts/schema.py`, with tests):

| Rule | Effect |
|---|---|
| No record may name the benchmark. | A record with "bixbench" in any field is refused. Hub datasets from the accounts of the benchmark's makers are left out too, whatever their name. |
| No single study from a primary archive. | GEO, SRA, ENA, ArrayExpress, PRIDE, MassIVE, MetaboLights, CELLxGENE and the Human Cell Atlas are listed as whole archives. A record that carries a study accession (GSE..., SRP..., PRJNA..., E-MTAB-..., PXD..., MTBLS..., phs...) is dropped. |
| No "data of one paper" deposits. | A record titled "Data from: ...", "Supplementary data for ..." or similar is dropped. Zenodo, Figshare and Dryad were not harvested by keyword; only named reference datasets were looked up. |

What it cannot do: the catalogue was built without looking at any benchmark task, question table
or answer. So nobody checked whether a dataset on Hugging Face, Kaggle or Zenodo comes from a
study that a task uses. That is why rule 2 is absolute.

## A download tool (not built)

If the team wants agents to fetch data, build one tool and give agents no other way.

| Check | Detail |
|---|---|
| Input is a catalogue `id` | Not a URL. The tool reads the URL from the catalogue. An agent cannot make it fetch an arbitrary address. |
| `access` must be `open` | For `registration`, a person downloads the file and places it in the data folder. |
| Licence policy | Refuse `commercial_use: no` when the run is marked commercial. For `unclear` or `unknown`, ask the person. For `share_alike: true`, write the licence into the run record: a result that contains the data must keep that licence. |
| Destination | Only `<run folder>/data/<catalogue id>/`, outside git. Run folders are already ignored (`board/runs/`, `glhf/runs/`). |
| Limits | A size cap per file and per run, a file-type allow-list, no archive unpacking outside the folder, a time limit. |
| Politeness | The rules of `scripts/common.py`: one identified User-Agent, robots.txt, the rate limit, no credential, redirects checked hop by hop. |
| Cost | Free public endpoints only. A record whose `notes` say "requester-pays" costs money: treat it as a paid call (`refusePaid()` in `engine/src/paid.ts`). |
| Record | Write `id`, URL, licence, bytes, SHA-256 and time into the run's events. On Durable replay, skip a download whose key (run, catalogue id, URL) is already stored. |
| Sandbox | The analysis sandbox keeps its network off. The engine downloads; the sandbox gets the folder read-only. |

## Text in the catalogue is untrusted

Names and descriptions come from third parties (dataset cards, registries). Some cards speak to
the reader. One real card started with a call to install a plugin in "your coding agents".

- `scripts/common.py` replaces a description that reads like instructions with a neutral line,
  and `scripts/schema.py` refuses such a record. This is a keyword filter. It is not complete.
- Any code that shows catalogue text to a model must wrap it in markers and escape it, as
  `engine/src/ask.ts` does for run records, and must tell the model that the text is data, not
  instructions.
- Text in the catalogue can never start a download or a run. Those need the tool above and a
  person's confirmation.

## Refreshing the catalogue

- A refresh makes network requests to public endpoints. They are free. They are still requests
  to other people's servers: run a refresh only when a person asks for it.
- No fetcher sends a key, a token or a cookie, and none reads `.env`.
- An AI agent must not set `DATASET_SCOUT_OPERATOR=human`. That variable is for a person who
  runs a fetcher by hand. It turns off the robots.txt groups that are written for AI agents.
- An AI agent must not add a host to `ROBOTS_EXEMPT_API_HOSTS` in `scripts/common.py`.
- Do not commit files from `/tmp/dataset-scout/`. Only `catalog.jsonl` and the small fixtures in
  `tests/fixtures/` belong in git.

## If the team wires it later

1. A read-only lookup for the drug board: search by words, domain and licence; return at most
   20 records; wrap the text as untrusted.
2. The download tool above, off by default, with a test for every check.
3. A test that a benchmark run cannot reach the lookup, in the style of the swarm's guard tests.
