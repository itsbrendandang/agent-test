# Sources of the dataset catalogue

One section per source: what it is, its licence and terms, the endpoint we used, the rate limit
we kept, what we took, and what to watch for. All facts here were read on the retrieval date of
the records (see `retrieved_at` in `catalog.jsonl`). Licences change: the fetchers read them
again on every run.

## Rules that hold for every source

| Rule | How it is kept |
|---|---|
| Free public endpoints only, no login, no key, no cookie | `scripts/common.py` sends one header set: a User-Agent that names the tool, and `Accept`. Nothing reads `.env`. |
| robots.txt is obeyed | `common.py` fetches robots.txt once per host and refuses a disallowed URL (also after a redirect, hop by hop). No host is exempt (`ROBOTS_EXEMPT_API_HOSTS` is empty). |
| Groups for AI agents in robots.txt are obeyed too | The catalogue was first built by an AI coding agent. A URL that a site forbids to `ClaudeBot`, `anthropic-ai`, `Claude-Web`, `Claude-User`, `GPTBot`, `ChatGPT-User` or `OAI-SearchBot` was not fetched. |
| At most about 2 requests per second per host | Default pause 0.6 s. Slower where the provider asks: `Crawl-delay` is honoured in full (EBI and Zenodo 10 s, NCBI, PubChem and Dryad 5 s, DepMap 500 s). |
| Metadata only | A reply larger than 64 MB is refused. Replies are cached under `/tmp/dataset-scout/cache`, never in the repository. |
| A licence is never guessed | See `scripts/licences.py`. A licence that is not stated is `unknown`. A statement that is not a known licence is kept in the provider's words with `commercial_use: unclear`. |

Two things went differently in the first pass and were corrected. The catalogue in this folder
comes from the corrected runs.

| What happened | What was done |
|---|---|
| The first HTTP client let the library follow redirects. So the robots.txt of a redirect target was not checked. One known case: Ensembl's licence page redirects to a mirror whose robots.txt disallows it. | The client now follows redirects itself and checks robots.txt at every hop. All hand-checked sources were fetched again from scratch. A refusal is stored in the cache, so an older copy of a page is never used. Ensembl's licence is `unknown` now. |
| The list of AI agent names first held Anthropic's names only. `genome.ucsc.edu` blocks `GPTBot` only, so two of its pages were read. | The list now holds OpenAI's names too. The UCSC pages are refused, their cached copies were deleted, and the UCSC entry has licence `unknown`. |

## Entries by fetcher

<!-- fetchers:begin -->
| Fetcher | Sources in the records | Entries | SPDX licence | Provider terms | Licence unknown |
|---|---|---|---|---|---|
| `fetch_huggingface.py` | huggingface | 528 | 487 | 18 | 23 |
| `fetch_obofoundry.py` | obo-foundry | 192 | 191 | 1 | 0 |
| `fetch_aws_open_data.py` | aws-open-data | 129 | 47 | 81 | 1 |
| `fetch_registry.py` | aact, alphafold-db, archs4, aws-open-data and 93 more | 97 | 32 | 40 | 25 |
| `fetch_gdc.py` | gdc | 72 | 0 | 72 | 0 |
| `fetch_tdc.py` | tdc | 68 | 35 | 33 | 0 |
| `fetch_datacite.py` | datacite, dataverse, figshare, mendeley-data and 1 more | 55 | 52 | 0 | 3 |
| `fetch_bioregistry.py` | bioregistry | 49 | 49 | 0 | 0 |
| `fetch_kaggle.py` | kaggle | 39 | 32 | 7 | 0 |
| `fetch_openfda.py` | openfda | 17 | 17 | 0 | 0 |
| `fetch_awesome_lists.py` | figshare, github, mendeley-data, zenodo | 16 | 13 | 0 | 3 |
<!-- fetchers:end -->

## Official APIs that we did not call, and why

These providers publish an API for programs, and their robots.txt disallows the API path for
crawlers. We took the strict reading of "respect robots.txt" and did not call them. A person who
decides that a provider's API terms take precedence over robots.txt can list the host in
`ROBOTS_EXEMPT_API_HOSTS` (`scripts/common.py`) and write a fetcher. An AI agent must not do that.

| Provider | Path that robots.txt disallows | What the catalogue lacks because of it | What we used instead |
|---|---|---|---|
| NCBI E-utilities (`eutils.ncbi.nlm.nih.gov`) | everything (`Disallow: /`) | record counts for GEO and SRA | landing pages and the NCBI policies page |
| PubChem PUG REST | `/rest/pug/` | one entry per assay depositor, counts | one entry each for PubChem and PubChem BioAssay |
| NCBI Datasets API, NCBI FTP | everything | reference genome entries | none |
| RCSB PDB data API (`data.rcsb.org`) | `/rest`, `/graphql` | entry counts by method | the RCSB usage policy page |
| ClinicalTrials.gov API | `/api/` | study counts, API version | the landing page (the terms page is script-driven and gave no text) |
| Zenodo REST API | `/api` | keyword search on Zenodo | DataCite (`fetch_datacite.py`) |
| EBI FTP (`ftp.ebi.ac.uk`) | everything | the list of Open Targets datasets, AlphaFold proteome archives, licence files | the providers' documentation pages |
| AlphaFold DB API | `/api/` | per-proteome entries | one entry for the database |
| ENCODE | `/search/` | one entry per assay type | one entry for ENCODE |
| GTEx Portal | everything for unnamed crawlers | everything: GTEx has licence `unknown` here | none |
| STRING API | `/api` | version and organism counts | the STRING access page |
| Human Cell Atlas (Azul and the data portal) | everything | counts; licence `unknown` here | none |
| Metabolomics Workbench | everything | everything; licence `unknown` here | none |
| CTD, HMDB, ClinPGx / PharmGKB | their pages disallow crawlers or do not serve robots.txt | licence pages not read | Bioregistry for ClinPGx; `unknown` for CTD and HMDB |

Sites that block AI agents by name in robots.txt (not read at all by the agent that built this):
**OpenML**, **WikiPathways**, **Reactome**, **SIDER** (`sideeffects.embl.de`), and the **UCSC
Genome Browser** site (it blocks `GPTBot`). A person may run the fetchers with
`DATASET_SCOUT_OPERATOR=human`; then only the general robots.txt group applies.

Sites that answer scripts with a bot challenge (HTTP 202 on robots.txt, treated as "disallowed"):
**figshare.com** (the API host `api.figshare.com` is open) and **dataverse.harvard.edu**.

## Hubs

### Hugging Face Hub (`fetch_huggingface.py`, ids `hf:*`)

| | |
|---|---|
| What | General hub of machine learning datasets. |
| Endpoint | `GET https://huggingface.co/api/datasets?filter=<tag>&sort=downloads&direction=-1&limit=1000` with `expand[]` fields, paged by the `Link` header. 27 tags (biology, chemistry, medical, drug-discovery, protein, genomics, single-cell, ...). 5,534 distinct datasets were seen. |
| Terms | Hub content is under each dataset's own licence. No token was sent. robots.txt allows `/api/`. |
| Rate | 0.7 s between requests; about 30 list requests. |
| Licence field | The `license:*` tag of the dataset card, set by the uploader. |
| Kept | Not gated, not private, not disabled; the name or description must speak of biology or chemistry; a licence tag and some use (2 likes or 300 downloads in 30 days), or no usable licence tag and much use (25 likes or 1,500 downloads); text sets for language models need more use; at most 15 datasets per account; of copies with one name, the most downloaded. |
| Caveats | A licence tag is the uploader's claim. Copies of third-party data can carry a wrong tag. `openrail` licences allow commercial use with behaviour rules: we mark them `unclear`. Downloads in 30 days are a noisy signal. Gating can change after the retrieval date. |

### Kaggle (`fetch_kaggle.py`, ids `kaggle:*`)

| | |
|---|---|
| What | Community dataset hub. |
| Endpoint | `GET https://www.kaggle.com/api/v1/datasets/list?search=<words>&sortBy=votes&page=<n>`. It answers without a login. 25 searches, 2 pages each. Only this list endpoint was called. Nothing was downloaded: downloads need an account. |
| Terms | Kaggle has no robots.txt (HTTP 404). Its API is documented for use with an account; the list endpoint is public. We kept the use small (at most 50 list requests). |
| Kept | A stated licence, usability at least 0.7, at least 30 votes, a title that names a biology or chemistry data type. |
| Caveats | **The licence is a label set by the uploader and is often wrong for copies of third-party data.** Every record says so in `notes`. Copies of KEGG, DrugBank, COSMIC, MIMIC, OMIM, UMLS and similar restricted sources are dropped by rule. Treat every `kaggle:*` entry as "check the original source". |

### Zenodo, Figshare, Dryad, Harvard Dataverse, Mendeley Data (`fetch_datacite.py`)

| | |
|---|---|
| What | General research data repositories. Each record has a DOI registered at DataCite. |
| Endpoint | `GET https://api.datacite.org/dois/<doi>` for the DOIs pinned in `scripts/seeds/datacite_dois.json`. DataCite metadata is CC0. |
| Why not the repositories' own APIs | Zenodo: its robots.txt disallows `/api`. Figshare and Dataverse: bot challenge. Dryad's API is allowed, but see the next row. |
| Why a pinned list and no keyword harvest | These repositories hold mostly the data of single papers. We tried keyword queries through DataCite: the top results by citation count were self-citing deposits and single-study files. There is no reliable sign of reuse (Zenodo does not report views or downloads to DataCite). And single-study deposits are outside the catalogue by design (benchmark boundary). So we name well-known reusable datasets and check each DOI: the title must hold an expected word, or the record is refused. |
| Licence field | DataCite `rightsList` (SPDX identifier or licence URL), set by the depositor. |
| Caveats | Dataverse writes CC0 as the default waiver. A DOI points to one version. Figshare landing pages could not be re-read (bot challenge); the sample check asks DataCite again instead. |

Repository-level entries exist for each hub (`db:zenodo`, `db:figshare`, `db:dryad`,
`db:harvard-dataverse`) with the API to search it. Dryad as a whole is CC0-1.0 (read on its site).

### Registry of Open Data on AWS (`fetch_aws_open_data.py`, ids `aws:*`)

| | |
|---|---|
| What | Registry of public datasets in AWS buckets (1,499 entries on the retrieval date). |
| Endpoint | `GET https://registry.opendata.aws/roda/ndjson/index.ndjson`, the registry's own index. One request (15 MB). |
| Kept | Not deprecated; at least one biology or chemistry tag; not earth observation, not physiological signals (PhysioNet), not clinical imaging; not controlled access only. |
| Licence field | Free text written by the data provider. Clear statements become SPDX; a sentence stays a sentence with `unclear`. Example: gnomAD's field names the MIT licence of its code and separate terms of use, so it is not reduced to "MIT". |
| Caveats | Some buckets are requester-pays (it costs money to download): see `notes`. Entries under the "NIH Genomic Data Sharing Policy" have open and controlled parts. |

### Community lists on GitHub (`fetch_awesome_lists.py`, ids `github:*` and DOI-based ids)

| | |
|---|---|
| What | The list `kjappelbaum/awesome-chemistry-datasets` (README from `raw.githubusercontent.com`). |
| How | A list gives names and links, no licences. A link is kept only where an official API states the licence: DataCite for Zenodo, Figshare and other DOIs; the GitHub API (`/repos/<owner>/<repo>`, field `license.spdx_id`) for repositories. 97 items read, 21 links could be asked, the rest point to web sites and were skipped. |
| Rate | GitHub allows 60 calls per hour without a token. The script stops at 45. |
| Caveats | A repository licence may cover the code and not the data: every `github:*` record says so. A link from a dataset name to a larger code repository is skipped. |

### OpenML (`fetch_openml.py`, no entries yet)

Not run. OpenML's robots.txt blocks AI agents by name. The script was written from the API
documentation and tested on a hand-made fixture only. A person can run it and should read the
first output with care. The ~16,000 `QSAR-TID-*` tables are left out on purpose.

### Papers with Code

Not covered. The site was closed in 2025 and its dataset list is no longer served. An archive on
the Hugging Face Hub would need a Parquet reader, which the standard-library fetchers do not have.

## Registries with licences

### OBO Foundry (`fetch_obofoundry.py`, ids `obo:*`)

| | |
|---|---|
| What | The registry of open biomedical ontologies (Gene Ontology, ChEBI, Cell Ontology, Uberon, Mondo, HPO, ...). |
| Endpoint | `GET https://obofoundry.org/registry/ontologies.jsonld`. One request. |
| Kept | Ontologies with `activity_status: active` that are not obsolete. |
| Licence field | The registry's `license` (label and URL). Most are CC BY 4.0, CC BY 3.0 or CC0. HPO has its own licence: kept by name. |

### Bioregistry (`fetch_bioregistry.py`, ids `bioregistry:*`)

| | |
|---|---|
| What | A curated registry of life-science databases and identifier schemes. Its metadata is CC0-1.0. |
| Endpoint | `GET https://raw.githubusercontent.com/biopragmatics/bioregistry/main/exports/registry/registry.json`. One request. |
| Kept | Databases (not ontologies, apart from a few that the OBO Foundry does not hold, such as EFO) that are not deprecated, have a description, and whose licence the registry gives as an SPDX identifier. One record per database, even when the registry has several identifier namespaces for it. |
| Homepages | The registry's homepage links go stale. The fetcher fetches each homepage once and drops an entry whose page does not answer (4 of 65 candidates). |
| Caveats | **The licence is the registry curators' reading, not re-read at the provider.** `licence_source` says so. The same holds for the four `db:*` entries whose licence fell back to Bioregistry: Reactome, gnomAD, ClinPGx and DrugCentral. |

## Dataset collections with their own fetcher

### Therapeutics Data Commons (`fetch_tdc.py`, ids `tdc:*`)

| | |
|---|---|
| What | Curated datasets for drug discovery machine learning: ADME, toxicity, screens, drug-target interaction, drug response, antibodies, retrosynthesis and more. |
| Endpoint | TDC has no listing API. The documentation pages are the official list: `GET https://tdcommons.ai/overview/` and the 21 task pages. robots.txt allows them. |
| Licence field | The line "Dataset License" in each dataset's section. |
| Caveats | For many datasets TDC writes "Not Specified. CC BY 4.0." That means the original source named no licence and TDC distributes its copy under CC BY 4.0. We keep that as a sentence with `commercial_use: unclear`. TDC's hERG and ADMET sets are the usual benchmark sets (`tdc:hERG`, `tdc:herg_central`, `tdc:Caco2_Wang`, ...). The PyTDC code is MIT. |

### NCI Genomic Data Commons (`fetch_gdc.py`, ids `gdc:*`)

| | |
|---|---|
| What | TCGA, TARGET, CPTAC and other NCI programmes. One record per project that has open-access files. |
| Endpoint | `GET https://api.gdc.cancer.gov/projects`, `GET https://api.gdc.cancer.gov/files` (facet on `access=open`), `GET https://api.gdc.cancer.gov/status`. The API host has no robots.txt. Three requests, and one for the policy page. |
| Terms | The GDC states a policy, not a licence: open and controlled access follow the NIH Genomic Data Sharing Policy. We keep the policy name, and only when the policy page still carries that sentence; `commercial_use` is `unclear`. |
| Caveats | Controlled-access files need dbGaP approval and are not part of any entry. A project is a consortium collection, not a single study. |

### openFDA (`fetch_openfda.py`, ids `openfda:*`)

| | |
|---|---|
| What | FDA data as an API and bulk files: drug adverse events (FAERS), labels, NDC, Drugs@FDA, recalls, substances and more. One record per endpoint. |
| Endpoint | `GET https://api.fda.gov/download.json` (the list of bulk files with record counts). |
| Licence | CC0-1.0. The fetcher writes it only when `https://open.fda.gov/license/` or `/terms/` still says "CC0 1.0 Universal". |
| Rate limit of the API | Without a key: 240 requests per minute and 1,000 per day per IP address. |
| Caveats | The FDA says the data are not validated for clinical decisions. Reaction terms use MedDRA, which has its own licence. Device registration and tobacco advertising endpoints are left out. |

## Primary databases, checked by hand (`fetch_registry.py`, ids `db:*`)

`scripts/seeds/registry.json` holds 98 seeds. For each one the fetcher checks three things
on every run: the landing page answers; a licence page of the provider matches a pattern (or
Bioregistry lists a licence; otherwise the licence is `unknown`); the DOI exists at Crossref
(`GET https://api.crossref.org/works/<doi>`) with the expected word in its title.

| Source | Licence as read | Evidence | Caveats |
|---|---|---|---|
| ChEMBL | CC-BY-SA-3.0 | ChEMBL documentation, "Creative Commons Attribution-ShareAlike 3.0 Unported" | **Share-alike.** A database built from ChEMBL data must keep the licence. |
| PubChem, PubChem BioAssay, GEO, SRA, ClinVar, dbSNP, RefSeq, NCBI Gene, NCBI Taxonomy, PubTator | NCBI policy (kept by name), `unclear` | NCBI policies page: NCBI "places no restrictions on the use or distribution of the data" | Submitters and depositors may hold rights. PubChem shows terms per data source. |
| BindingDB | CC-BY-3.0-US | BindingDB info page | The dated BindingDB snapshot with a DOI (`datacite:10.6075/j02v2h30`) states CC BY 4.0. |
| ZINC | `unknown` | The site needs a script to show its terms | Reported terms: free to use; redistribution of large subsets needs permission. |
| DrugBank Open Data | CC0-1.0 | DrugBank releases page | **Only the open vocabulary and structures.** The full DrugBank is CC BY-NC 4.0, academic only, behind an approved account: not listed. |
| Open Targets Platform | CC0-1.0 | Open Targets licence page | |
| PDB (wwPDB, RCSB) | CC0-1.0 | RCSB usage policy | |
| AlphaFold DB | CC-BY-4.0 | AlphaFold DB home page | |
| PDBbind | `unknown`, access `registration` | none | Needs an account; recent releases have commercial terms. Open alternatives listed: BindingDB, BioLiP, PLINDER (Apache-2.0, code repository licence), HiQBind, MISATO. |
| Tox21, ToxCast pages | `unknown` | their pages state no licence | The ToxCast database itself is on EPA's Figshare with CC0 (`figshare:10.23645/epacomptox.6062623`). |
| SIDER | `unknown` | not read: the site blocks AI agents | Reported CC BY-NC-SA 4.0. A Zenodo copy by the SIDER author states CC BY 4.0 (`zenodo:10.5281/zenodo.7877719`). The two do not agree: check before commercial use. |
| FAERS quarterly files | Public domain (FDA website policy), kept by name | FDA website policies page | The same reports are in openFDA under CC0. |
| ClinicalTrials.gov | `unknown` | the terms page is script-driven | Reported: public registry data, attribution asked. AACT is a relational copy (licence not stated on its page). |
| DrugCentral | CC-BY-SA-4.0 | Bioregistry (the site's pages gave no licence text) | **Share-alike.** |
| Guide to PHARMACOLOGY | CC-BY-SA-4.0 AND ODbL-1.0 | GtoPdb about page names both | **Share-alike**, both parts. |
| Drug Repurposing Hub | CC BY 4.0 with added limits, kept by name, `unclear` | the Hub's own page | **Doubtful.** The page names CC BY 4.0 and also forbids commercial redistribution and commercial marketing use. |
| Natural Products Atlas | CC-BY-NC-4.0 | NP Atlas download page | Non-commercial. |
| ENA | INSDC policy (kept by name), `yes` | INSDC policy page: free and unrestricted access, no use restrictions | |
| BioStudies / ArrayExpress, MetaboLights, PRIDE, PDBe, EMDB, IntAct, MGnify, BioImage Archive | EMBL-EBI Terms of Use (kept by name), `unclear` | EBI terms of use: no restrictions beyond the data owner's | Single records can carry CC0 or CC BY. PRIDE's own licence page is script-driven. |
| Expression Atlas, eQTL Catalogue, JASPAR, UniProt, STRING, Cellosaurus, OAS, ESM Atlas, CELLxGENE | CC-BY-4.0 | each provider's page (CELLxGENE, JASPAR: see `licence_source`) | |
| GDC | NIH Genomic Data Sharing Policy (kept by name), `unclear` | GDC data access policies page | Open tier only. |
| ENCODE | ENCODE data use policy (kept by name), `yes` | ENCODE page: download, analyse and publish "without restrictions" | Citation is asked. |
| GTEx, Human Cell Atlas, Metabolomics Workbench, HMDB, CTD | `unknown` | their robots.txt disallows crawlers | Reported: HMDB CC BY-NC 4.0; CTD free for research and education only. |
| ARCHS4 | CC BY 4.0 with the added line "free for non-commercial purposes", kept by name, `no` | ARCHS4 help page | **Doubtful.** The page names CC BY 4.0 and limits free use to non-commercial purposes in the next sentence. |
| Ensembl | `unknown` | the licence page redirects to a mirror whose robots.txt disallows it | Reported: no restrictions on use. |
| GENCODE | "all project data is open access" (kept by name), `unclear` | GENCODE data access page | No licence named. |
| 1000 Genomes (IGSR) | IGSR statement (kept by name), `unclear` | IGSR disclaimer page | |
| gnomAD | CC0-1.0 | Bioregistry | The gnomAD site is script-driven. |
| GWAS Catalog, EMPIAR, COCONUT, Dryad | CC0-1.0 | each provider's page or Bioregistry | |
| MSigDB | CC-BY-4.0, access `registration` | MSigDB licence terms page | Sub-collections derived from KEGG or BioCarta have other terms. |
| cBioPortal datahub | ODbL-1.0 | cBioPortal FAQ: "available under the ODC Open Database License" | **Share-alike.** Some studies have other terms. |
| Human Protein Atlas | CC-BY-4.0 | HPA licence page: "Creative Commons Attribution 4.0 International License for all copyrightable parts" | **Changed.** Earlier versions were CC BY-SA 3.0. The fetcher tries the share-alike patterns first and takes what the page says. The page adds that some data have third-party constraints. |
| Reactome | CC0-1.0 | Bioregistry (the site blocks AI agents) | Reactome has also described its terms as CC BY 4.0. Check its licence page. |
| BioGRID | MIT | BioGRID download page | |
| RxRx | CC-BY-NC-SA-4.0 | rxrx.ai | Non-commercial and share-alike. |
| IEDB, SAbDab, IDR, MassIVE, OpenAlex, recount3, LINCS, MoleculeNet, PubMed, NCATS ADME, Biogen ADME, AACT | `unknown` | their pages are script-driven or state no licence | See `notes` on each record for the reported terms. |

## Sources left out, and why

| Source | Reason |
|---|---|
| KEGG | Restricted. The FTP needs a paid subscription; the web API is for academic use only. Copies of KEGG on hubs are dropped by rule. |
| DrugBank (full database) | CC BY-NC 4.0, academic only, approved account needed. Only the CC0 open data is listed. |
| COSMIC, OMIM, HGMD, TRANSFAC, UMLS, SNOMED CT, MedDRA | Licensed or account-only with a fee for commercial use. |
| MIMIC, UK Biobank, dbGaP controlled data, GTEx protected data, TCGA controlled tier | Gated: an application or signed agreement is needed. |
| GDSC (cancerrxgene.org) | The site answered HTTP 410: the data moved into the Sanger DepMap. |
| BioSamples | Its landing page answered HTTP 500 on every run. An entry whose page does not answer is not listed. |
| Single studies in GEO, SRA, ENA, ArrayExpress, PRIDE, MassIVE, MetaboLights, CELLxGENE, Human Cell Atlas | Outside the catalogue by design. See `AGENT_USE.md`, "The benchmark boundary". |
