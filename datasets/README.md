# Dataset catalogue

A list of open datasets that our agents could use for real research: drug-candidate review and
computational biology analysis. It is a **list of pointers** (name, address, licence, how we
found it). It holds no data. Nothing in the engine or the dashboard reads it yet.

Read this first:

| If you want to | Read |
|---|---|
| Know which rules agents must follow | [AGENT_USE.md](AGENT_USE.md) |
| Know where each entry comes from, its terms and caveats | [sources.md](sources.md) |
| Look up a dataset | `catalog.jsonl` (one JSON record per line) |

## Words used here

| Word | Meaning |
|---|---|
| Record, entry | One line of `catalog.jsonl`. It describes one dataset, one collection or one whole archive. |
| Fetcher | A script in `scripts/` that reads one source and writes records. |
| Source | Where a dataset lives or who provides it (`huggingface`, `chembl`, `gdc`, ...). |
| Hub | A general site where anybody uploads datasets (Hugging Face, Kaggle, Zenodo, Figshare, Dryad). |
| Seed | A hand-written entry in `scripts/seeds/`. A fetcher checks every claim in it against the provider's pages. |
| SPDX identifier | A standard short name of a licence, for example `CC-BY-4.0`. |
| Share-alike | A licence condition: work that contains the data must be given out under the same licence. |
| Benchmark boundary | The rule that benchmark agents must not find the study they reproduce. See [AGENT_USE.md](AGENT_USE.md). |

## Files

| Path | Content |
|---|---|
| `catalog.jsonl` | The catalogue. Sorted by `id`. Written by `scripts/build_catalog.py`. |
| `sources.md` | One section per source: terms, endpoint, rate limit, entries, caveats. |
| `AGENT_USE.md` | How agents may use the catalogue. A proposal: nothing is wired. |
| `scripts/common.py` | The polite HTTP client: one User-Agent, robots.txt, rate limit, cache, request log. |
| `scripts/licences.py` | Licence normalisation. `scripts/spdx_ids.txt` is the SPDX list it uses. |
| `scripts/schema.py` | The record format, validation, and the boundary rules. |
| `scripts/tagging.py` | Domain tags and modality from keywords, for hub records. |
| `scripts/fetch_*.py` | One fetcher per source. |
| `scripts/seeds/registry.json` | Hand-written seeds for the primary databases (ChEMBL, PDB, GEO, ...). |
| `scripts/seeds/datacite_dois.json` | DOIs of named reference datasets on Zenodo, Figshare, Dryad and Dataverse. |
| `scripts/build_catalog.py` | Validates, removes duplicates, writes `catalog.jsonl`, refreshes the count tables below. |
| `scripts/verify_sample.py` | Re-checks a random sample against the live sources. |
| `tests/` | Offline tests on recorded replies (`tests/fixtures/`). |

## The record format

| Field | Meaning |
|---|---|
| `id` | `<prefix>:<native id>`, for example `db:chembl`, `hf:tahoebio/Tahoe-100M`, `tdc:hERG`, `gdc:TCGA-BRCA`. |
| `name` | Name of the dataset. |
| `source` | Provider or hub. |
| `url` | Landing page for a person. |
| `landing_api` | API address for this dataset, or `null`. |
| `domains` | One or more tags from a fixed list (`scripts/schema.py`, `DOMAINS`). |
| `modality` | Kind of data: tabular, sequence, 3D structure, image, text, ... |
| `description` | One or two lines. From the source (cut to 300 characters) or in our words. Untrusted text: see [AGENT_USE.md](AGENT_USE.md). |
| `size` | Size as the source states it, or `null`. |
| `format` | File formats, or `unknown`. |
| `licence` | An SPDX identifier where the source is clear. The provider's own words where there is no identifier. `unknown` where no licence is stated. Never a guess. |
| `access` | `open` or `registration` (a free account is needed). Gated sources are not in the catalogue. |
| `commercial_use` | `yes`, `no` or `unclear`. It follows from the licence. `unclear` for every licence that is not an SPDX identifier, unless the provider's page settles it. |
| `share_alike` | `true` when the licence has a share-alike or copyleft condition. |
| `citation` | A DOI (or arXiv id) of the dataset or of the database paper, or `null`. |
| `last_updated` | Date the source gives, or `null`. |
| `retrieved_at` | When the source answered (UTC). It comes from the cache, so a rebuild does not change it. |
| `how_retrieved` | The endpoint. |
| `level` | `repository` (a whole archive), `collection` (a project or release) or `dataset`. |
| `fetcher` | The script that wrote the record. |
| `licence_raw`, `licence_source` | The licence as the source wrote it, and where we read it. |
| `signals` | Numbers that hint at use: downloads, likes, votes, citations, stars. |
| `notes`, `same_as` | Caveats; ids of other registry entries for the same resource. |

Example:

```json
{"id": "db:chembl", "name": "ChEMBL", "source": "chembl", "url": "https://www.ebi.ac.uk/chembl/", "licence": "CC-BY-SA-3.0", "access": "open", "commercial_use": "yes", "share_alike": true, "level": "repository", "...": "..."}
```

## How to refresh

You need Python 3.9 or newer. The fetchers use the standard library only. The commands below use
`uv`, which the repository already needs; plain `python3` works too.

```bash
cd datasets/scripts

# 1. Fetch. Each fetcher writes /tmp/dataset-scout/records/<source>.jsonl.
#    Replies are cached in /tmp/dataset-scout/cache, so a fetcher that stops can be run again.
uv run --no-project python fetch_huggingface.py
uv run --no-project python fetch_aws_open_data.py
uv run --no-project python fetch_kaggle.py
uv run --no-project python fetch_gdc.py
uv run --no-project python fetch_openfda.py
uv run --no-project python fetch_obofoundry.py
uv run --no-project python fetch_bioregistry.py
uv run --no-project python fetch_tdc.py
uv run --no-project python fetch_datacite.py
uv run --no-project python fetch_awesome_lists.py
uv run --no-project python fetch_registry.py      # slow: it honours crawl delays of 5 to 10 s

# 2. Build: validate, remove duplicates, write ../catalog.jsonl, refresh the count tables.
uv run --no-project python build_catalog.py

# 3. Check.
uv run --no-project python build_catalog.py --check
cd .. && uv run --no-project --with pytest pytest

# 4. Optional: re-check a random sample against the live sources.
cd scripts && uv run --no-project python verify_sample.py --n 48 --seed 20261114
```

| Setting | Effect |
|---|---|
| `DATASET_SCOUT_REFRESH=1` | Ignore the cache and fetch again. Without it a fetcher reads the cache. |
| `DATASET_SCOUT_OFFLINE=1` | Never use the network. A fetcher then works from the cache only. The tests set it. |
| `DATASET_SCOUT_DIR` | The work folder. Default `/tmp/dataset-scout`. |
| `DATASET_SCOUT_UA` | The User-Agent. Set it to name yourself and a contact address. |
| `DATASET_SCOUT_OPERATOR=human` | For a person only. See [AGENT_USE.md](AGENT_USE.md). |

A fetcher that was not run again keeps its old records: the build carries them over from the
existing `catalog.jsonl`. So you can refresh one source alone.

The output is the same for the same cache: records are sorted by `id`, keys are sorted, and
`retrieved_at` is the time of the cached reply.

Building this catalogue took 1,500 requests in total. That number counts everything: first
probes, robots.txt files, redirects, retries, a second full pass over the hand-checked sources
and two sample checks. A plain refresh needs fewer, roughly 800. Every request is listed in
`/tmp/dataset-scout/requests.log`.

## Counts

The tables below are written by `scripts/build_catalog.py`. A test fails when they do not match
`catalog.jsonl`.

<!-- stats:begin -->
Total entries: **1262**

| What | Entries |
|---|---|
| Commercial use allowed by the licence (`commercial_use: yes`) | 892 |
| ... of these, with no share-alike condition | 837 |
| Commercial use not allowed (`no`) | 80 |
| Not clear from the licence or no licence stated (`unclear`) | 290 |
| Share-alike (`share_alike: true`) | 95 |
| Licence is an SPDX identifier | 955 |
| Licence is the provider's own terms (kept as a name) | 252 |
| Licence `unknown` | 55 |
| Access `open` | 1259 |
| Access `registration` (free account needed) | 3 |

By source:

| Source | Entries |
|---|---|
| huggingface | 529 |
| obo-foundry | 192 |
| aws-open-data | 130 |
| gdc | 73 |
| tdc | 69 |
| bioregistry | 49 |
| kaggle | 40 |
| zenodo | 29 |
| figshare | 26 |
| openfda | 17 |
| github | 8 |
| datacite | 4 |
| dataverse | 4 |
| mendeley-data | 2 |
| (primary databases with one entry each, ids `db:*`) | 90 |

By level:

| Level | Entries |
|---|---|
| dataset | 1056 |
| collection | 107 |
| repository | 99 |

By domain (one entry can have several domains):

| Domain | Entries |
|---|---|
| genomics | 442 |
| chemistry | 430 |
| protein | 255 |
| drug-discovery | 234 |
| ontology | 221 |
| transcriptomics | 205 |
| medical | 197 |
| cancer | 160 |
| variation | 153 |
| clinical | 146 |
| imaging | 121 |
| structural-biology | 106 |
| text-literature | 97 |
| single-cell | 85 |
| epigenomics | 80 |
| microbiome | 78 |
| admet | 71 |
| proteomics | 70 |
| quantum-chemistry | 69 |
| bioactivity | 58 |
| immunology | 53 |
| perturbation | 53 |
| model-organism | 46 |
| pathways-networks | 42 |
| toxicology | 35 |
| metabolomics | 29 |
| reactions-synthesis | 28 |
| pharmacovigilance | 19 |
| materials | 18 |
| plant-agri | 18 |
| general-biology | 17 |
| clinical-trials | 15 |
| multi-omics | 7 |

By licence (the 25 most frequent):

| Licence | Entries |
|---|---|
| CC-BY-4.0 | 399 |
| CC0-1.0 | 138 |
| MIT | 133 |
| Apache-2.0 | 83 |
| NIH Genomic Data Sharing Policy; GDC open-access tier (no licence stated) | 73 |
| unknown | 55 |
| CC-BY-3.0 | 53 |
| CC-BY-NC-SA-4.0 | 37 |
| CC-BY-NC-4.0 | 31 |
| Not specified by the original source; TDC distributes it under CC BY 4.0 | 30 |
| CC-BY-SA-4.0 | 25 |
| other (see source) | 20 |
| NIH Genomic Data Sharing Policy: https://gdc.cancer.gov/access-data/data-access-policies | 14 |
| NCBI data usage policy: NCBI places no restrictions on use or distribution; submitters may hold rights | 10 |
| ODbL-1.0 | 9 |
| CC-BY-SA-3.0 | 8 |
| EMBL-EBI Terms of Use: no restrictions beyond those of the data owner | 8 |
| No restrictions on use (as stated by the source) | 7 |
| CC-BY-NC-ND-4.0 | 5 |
| GPL-3.0 | 5 |
| NCBI Policy and NIH Genomic Data Sharing Policy | 5 |
| BSD-3-Clause | 4 |
| Public domain (as stated by the source) | 4 |
| http://www.alleninstitute.org/legal/terms-use/ | 3 |
| Artistic-2.0 | 2 |
<!-- stats:end -->

## Which entries are safe for commercial use

Filter on the fields. Do not read the licence text yourself to save time: the fields were set by
one rule set (`scripts/licences.py`) and tested.

```bash
# commercial use allowed by the licence, and no share-alike condition
jq -c 'select(.commercial_use == "yes" and .share_alike == false and .access == "open")' catalog.jsonl

# share-alike entries (commercial use is allowed, but derived work must keep the licence)
jq -c 'select(.share_alike == true) | [.id, .licence]' catalog.jsonl

# entries that need a person's decision
jq -c 'select(.commercial_use != "yes") | [.id, .licence, .commercial_use]' catalog.jsonl
```

| Group | What it means | Examples |
|---|---|---|
| `commercial_use: yes`, `share_alike: false` | Permissive licence or public-domain dedication: CC0, CC BY, MIT, Apache-2.0, ODC-By, PDDL, or a provider statement of "no restrictions". Attribution is still required for all but CC0 and PDDL. | Open Targets (CC0), PDB (CC0), UniProt (CC BY 4.0), AlphaFold DB (CC BY 4.0), openFDA (CC0), ToxCast database (CC0), ENCODE |
| `commercial_use: yes`, `share_alike: true` | Commercial use is allowed. A database or a work that contains the data must be given out under the same licence. Decide with care before you mix such data into a product or into another dataset. | **ChEMBL (CC BY-SA 3.0)**, DrugCentral (CC BY-SA 4.0), Guide to PHARMACOLOGY (ODbL and CC BY-SA 4.0), Open Reaction Database (CC BY-SA 4.0), cBioPortal datahub (ODbL), Papyrus and ExCAPE-DB (CC BY-SA 4.0, they contain ChEMBL data) |
| `commercial_use: no` | A non-commercial licence, or the provider says so. | Natural Products Atlas (CC BY-NC 4.0), RxRx (CC BY-NC-SA 4.0), ARCHS4 (provider's statement), many Hugging Face sets under CC BY-NC |
| `commercial_use: unclear` | No licence stated, a provider policy that is not a licence, or a licence we could not read. **Not cleared for commercial use.** | NCBI resources (GEO, SRA, PubChem: NCBI sets no restrictions but submitters may hold rights), EMBL-EBI Terms of Use resources, GDC open tier, GTEx, ClinicalTrials.gov, most TDC sets ("Not Specified") |

Limits of these fields:

- They report what the source states. They are not legal advice.
- On hubs the licence is the uploader's claim. A copy of third-party data can carry a wrong
  licence tag. This is most common on Kaggle.
- "Derived from" matters: a dataset built from ChEMBL keeps ChEMBL's share-alike condition, even
  when its own tag says something else.
- `yes` for CC BY-ND entries means commercial use of the unchanged data. No-derivatives licences
  forbid giving out changed versions.

Legally doubtful entries that we found are listed in [sources.md](sources.md) (Drug Repurposing
Hub, ARCHS4, SIDER, Reactome, Human Protein Atlas, Kaggle in general).

## The 25 most useful datasets for our agents

Ranked for the two uses we have: the drug board (go / no-go on a drug candidate) and computational
biology analysis. The rank is our judgement. It is not computed.

| # | id | Why |
|---|---|---|
| 1 | `db:chembl` | The main open source of measured bioactivity for a candidate, its target and its analogues. Share-alike. |
| 2 | `db:opentargets-platform` | Target-disease evidence in one place (genetics, known drugs, expression, literature). CC0, with a GraphQL API. |
| 3 | `db:clinicaltrials-gov` | What was tried in people, with which design and result: needed for any go / no-go memo. Licence not read (see notes). |
| 4 | `openfda:drug/event` | FAERS adverse event reports as JSON: safety signals for a drug or a class. CC0. |
| 5 | `openfda:drug/label` | Approved labels: indications, warnings, interactions, as structured text. CC0. |
| 6 | `db:bindingdb` | Measured protein-ligand affinities, including patent data that ChEMBL does not have. |
| 7 | `db:pubchem-bioassay` | Raw screening results, including Tox21 and the NIH screens; large and uneven. |
| 8 | `db:tdc` | Ready ADMET and toxicity benchmark sets with fixed splits. Start with `tdc:hERG`, `tdc:herg_central`, `tdc:Caco2_Wang`, `tdc:AMES`. |
| 9 | `figshare:10.23645/epacomptox.6062623` | The ToxCast database (invitroDB): in vitro toxicity profiles for thousands of chemicals. CC0. |
| 10 | `db:pdb` | Experimental structures of targets and complexes. CC0. |
| 11 | `db:alphafold-db` | A predicted structure for almost any protein when there is no experimental one. CC BY 4.0. |
| 12 | `db:uniprot` | Function, isoforms, variants and cross-references for every target. CC BY 4.0. |
| 13 | `db:drugcentral` | Approved drugs with targets, indications and label-derived data: a compact comparator set. Share-alike. |
| 14 | `db:gtopdb` | Expert-curated target-ligand pharmacology with selectivity. Share-alike. |
| 15 | `db:geo` | The largest archive of expression studies: the first place to look for data on a disease or a perturbation. |
| 16 | `db:gdc` | TCGA and other cancer cohorts, open tier: expression, mutations, clinical tables. Each project has its own entry, for example `gdc:TCGA-BRCA`. |
| 17 | `db:cellxgene` | Standardised single-cell data and the Census: cell-type expression of a target across tissues. CC BY 4.0. |
| 18 | `figshare:10.6084/m9.figshare.22765112` | A DepMap public release: which genes cancer cell lines depend on, with expression and mutations. CC BY 4.0. |
| 19 | `db:hpa` | Protein and RNA expression of a target by tissue and cell type: on-target toxicity questions. CC BY 4.0 as read. |
| 20 | `db:gnomad` | Human variant frequencies and gene constraint: is loss of the target tolerated in people? |
| 21 | `db:reactome` | Curated pathways for enrichment analysis and mechanism questions. |
| 22 | `db:string` | Protein association networks for target context and for network analysis. CC BY 4.0. |
| 23 | `obo:go` | The Gene Ontology: the vocabulary behind most enrichment analyses. CC BY 4.0. |
| 24 | `db:encode` | Uniformly processed regulatory genomics data, free of restrictions. |
| 25 | `hf:tahoebio/Tahoe-100M` | 100 million single-cell profiles of drug-treated cancer cell lines: perturbation response at scale. CC0. |

Close behind: `db:gtex` (expression by tissue; licence not read), `db:ensembl` and `db:gencode`
(reference annotation), `db:msigdb` (gene sets; free account), `db:gwas-catalog`,
`db:drugbank-open`, `zenodo:10.5281/zenodo.7041848` (scPerturb),
`figshare:10.6084/m9.figshare.5104873` (reactions from US patents),
`figshare:10.6084/m9.figshare.14267219` (Tabula Sapiens), `db:expression-atlas`, `db:sra`.

## Known gaps

| Gap | Why | What would close it |
|---|---|---|
| No single studies from GEO, SRA, ENA, ArrayExpress, PRIDE, MassIVE, MetaboLights, CELLxGENE, Human Cell Atlas | By design: the benchmark boundary. | Nothing. Agents search those archives live, in research mode only. |
| Several official APIs were not called | Their robots.txt disallows the API path (NCBI E-utilities, PubChem PUG REST, RCSB, ClinicalTrials.gov, Zenodo, ENCODE search, GTEx, STRING, AlphaFold, EBI and NCBI FTP). | A person's decision that API terms take precedence. See [sources.md](sources.md). |
| So there are no sub-entries per PubChem depositor, ENCODE assay, AlphaFold proteome, Open Targets dataset, UniProt proteome | Same reason, or no listing endpoint that we may read. | Same. |
| OpenML: no entries | Its robots.txt blocks AI agents. `fetch_openml.py` is written and not run. | A person runs it. |
| Papers with Code: not covered | The site is closed. | A Parquet reader for the archived list. |
| Zenodo, Figshare, Dryad: named datasets only | No reliable sign of reuse for a keyword harvest, and single-study deposits are outside the catalogue. | More DOIs in `scripts/seeds/datacite_dois.json`. |
| One community list only | Most links in such lists go to web sites, where no API states a licence. | More lists in `fetch_awesome_lists.py`. |
| Licence `unknown` for some important sources | Their licence pages need a browser script, or their robots.txt keeps scripts out: GTEx, ClinicalTrials.gov, Human Cell Atlas, Ensembl, HMDB, CTD, ZINC, SIDER, IEDB, SAbDab, MassIVE, LINCS, recount3. | A person reads the page and adds evidence the fetcher can check. The `notes` field holds the reported terms. |
| `size` is empty for most hand-checked entries | Sizes come from APIs that we did not call. | Same as the API gap. |
| Hub quality signals are weak | Downloads in 30 days, likes and votes can be gamed. | A person reviews new hub entries. |
| Licences on hubs are uploader claims | See "Which entries are safe for commercial use". | Check the original source before use. |
| Sources left out | KEGG, full DrugBank, COSMIC, OMIM, UMLS, MedDRA (restricted); MIMIC, UK Biobank, dbGaP (gated); GDSC (site gone). | Nothing: they are not open. |

## Checks that were done

| Check | Result |
|---|---|
| Every record passes `scripts/schema.py` | Yes. `build_catalog.py --check` and the tests enforce it. |
| No duplicate by id, by address, or by dataset DOI | Yes. |
| No record names the benchmark, carries a study accession, or is titled like the data of one paper | Yes, by rule and by test. |
| Hand-checked entries: landing page, licence page and DOI | Checked by `fetch_registry.py` on every run. A claim that fails becomes `unknown` or `null`. |
| Random sample re-checked against the live sources | See below. |

<!-- sample:begin -->
Sample check (`scripts/verify_sample.py`, 48 random records, seed 20261114). It was run twice:
once on an earlier build, and again after the fix that the first run led to. The two samples are
different draws, because the catalogue changed in between. After the final run one more boundary
rule removed 2 entries (hub datasets from the benchmark makers' accounts). Neither was in the
sample. So all 48 sampled records are in the catalogue of this folder (1,262 entries), with the
same addresses and the same licences; one licence (`aws:gmsdata`) is now written as the SPDX
identifier `LGPL-3.0` in place of the same licence in words.

| | First run (earlier build, 1,267 entries) | Final run (1,264 entries) |
|---|---|---|
| Landing page answers | 44 | 44 |
| Landing page closed to scripts (robots.txt or a bot challenge) | 3 | 4 |
| Landing page error | **1** (`bioregistry:icdo`, HTTP 404) | 0 |
| Licence equals what the source states now | 32 | 46 |
| Licence differs from the source | 0 | 0 |
| Licence could not be checked | 16 (the first check script had fewer routes) | 2 (hub entries with "Varies by dataset") |
| **Records with an error** | **1 of 48 (2.1%)** | **0 of 48 (0%)** |

| Point | Detail |
|---|---|
| What the first run found | A homepage link taken from Bioregistry was dead. The Bioregistry fetcher now fetches every homepage and drops an entry whose page does not answer. That removed 4 entries. |
| How sure 0 of 48 is | Not very. With 48 records and no error, the true error rate can still be about 6% (95% bound). |
| What "licence equals" means | The licence was read again by the route the fetcher used: the source's API (27 records), the evidence page with its pattern (8), the landing page (10), the TDC section (1). This finds stale and mis-read values. It does not show that an uploader's licence claim is true. |
| Seen on the landing page too | For 30 of the 48 records the licence also stands on the landing page itself. |
| Name on the page | On 37 of the 44 readable pages the dataset's name stands in the page text. The other 7 are pages that a browser script fills in (5 GDC portal pages, 1 openFDA page, 1 database home page). |
| Report file | `/tmp/dataset-scout/verify/report.json` (not in git). |
<!-- sample:end -->

## Tests

```bash
cd datasets && uv run --no-project --with pytest pytest
```

The tests are offline. They read recorded replies in `tests/fixtures/` and the catalogue itself.

| File | What it covers |
|---|---|
| `tests/test_schema.py` | Record validation and the boundary rules. |
| `tests/test_licences.py` | Licence normalisation: what becomes an SPDX identifier and what must not. |
| `tests/test_dedup.py` | Duplicate removal and the order of the output. |
| `tests/test_fetchers.py` | Each fetcher's parsing, on recorded replies. |
| `tests/test_common.py` | robots.txt rules, the cache, offline mode. |
| `tests/test_catalog.py` | The catalogue in the repository: valid, inside the boundary, counts in this file up to date. |

They are not part of `npm test`. That command belongs to other folders.
