"""The record format of datasets/catalog.jsonl, its validation, and the boundary filters.

One JSON object per line. validate(record) returns a list of problems; an empty list means valid.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Sequence

import common
import licences

# Controlled vocabulary for the "domains" field.
DOMAINS = (
    "admet", "bioactivity", "cancer", "chemistry", "clinical", "clinical-trials", "drug-discovery",
    "epigenomics", "general-biology", "genomics", "imaging", "immunology", "materials", "medical",
    "metabolomics", "microbiome", "model-organism", "multi-omics", "ontology", "pathways-networks",
    "perturbation", "pharmacovigilance", "plant-agri", "protein", "proteomics", "quantum-chemistry",
    "reactions-synthesis", "single-cell", "structural-biology", "text-literature", "toxicology",
    "transcriptomics", "variation",
)
ACCESS = ("open", "registration")  # "gated" sources are left out of the catalogue
COMMERCIAL = ("yes", "no", "unclear")
LEVELS = ("repository", "collection", "dataset")

REQUIRED = (
    "id", "name", "source", "url", "landing_api", "domains", "modality", "description", "size",
    "format", "licence", "access", "commercial_use", "share_alike", "citation", "last_updated",
    "retrieved_at", "how_retrieved",
)
OPTIONAL = ("level", "licence_raw", "licence_source", "fetcher", "signals", "notes", "same_as")

MAX_DESCRIPTION = 400
_ID = re.compile(r"^[a-z][a-z0-9-]*:[^\s]{1,200}$")
_URL = re.compile(r"^https?://[^\s]+$")
_DATE = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?$")
_STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
_DOI = re.compile(r"^10\.\d{4,9}/\S+$")

# ---------------------------------------------------------------------------------------------
# Boundary filters
# ---------------------------------------------------------------------------------------------

# The benchmark itself is never an entry. To stay well clear of it, hub datasets from the
# accounts of the benchmark's makers are left out too, whatever their name.
BENCHMARK = re.compile(r"bix[\s_-]?bench", re.I)
BENCHMARK_MAKERS = re.compile(r"^(hf|kaggle|github):(futurehouse|edisonscientific|future-house)/", re.I)

# Accession numbers of single studies in the primary archives. The catalogue lists those archives
# as a whole. It does not list single studies, so a record that carries one of these is dropped.
STUDY_ACCESSION = re.compile(
    r"(?<![A-Za-z0-9])("
    r"GSE\d{3,}|GSM\d{4,}|GDS\d{3,}"  # GEO
    r"|[SED]R[PRXSA]\d{5,}|PRJ(?:NA|EB|DB)\d+|SAM(?:N|EA|D)\d{6,}"  # SRA, ENA, DDBJ, BioProject, BioSample
    r"|E-[A-Z]{4}-\d+"  # ArrayExpress
    r"|S-[A-Z]{3,5}\d+"  # BioStudies
    r"|PXD\d{6}|MSV\d{9}|RPXD\d{6}"  # ProteomeXchange, MassIVE
    r"|MTBLS\d+|ST\d{6}"  # MetaboLights, Metabolomics Workbench
    r"|phs\d{6}|EGA[SDC]\d{11}"  # dbGaP, EGA
    r"|HRA\d{6}|CRA\d{6}|OEP\d{6}"  # GSA, NODE
    r")(?![A-Za-z0-9])"
)

# Titles of a deposit that holds the data of one paper ("Data from: ...", "Supplementary data
# for ...", "Table S3 in ..."). A reusable dataset is not named like that.
PAPER_SUPPLEMENT = re.compile(
    r"^\s*(?:"
    # "Supplementary data ...", "Source data ...", "Additional file 4 ...", "Accompanying data ..."
    r"(?:raw|source|processed|supporting|supplementa\w*|underlying|replication|additional|accompanying)\s+"
    r"(?:data|datasets?|information|materials?|files?|tables?|figures?|code)\b"
    # "Data from: ...", "Dataset for - ...", "Code and data: ..."
    r"|(?:data|datasets?|code|scripts|materials)(?:\s+(?:and|&)\s+\w+)?"
    r"\s*(?:for|from|of|to|accompanying|associated with|underlying|supporting|used in)?\s*[:\u2013\u2014-]\s"
    # "Code and data for ...", "Data and scripts from ..."
    r"|(?:data|code)\s+(?:and|&)\s+(?:code|data|scripts?|software)\s+(?:for|from|of|to|accompanying|associated with|underlying|supporting)\b"
    # "Data for 'Title of the paper'"
    r"|(?:data|datasets?)\s+(?:for|from|accompanying|supporting|underlying)\s+[\"'\u201c\u2018]"
    # "Table S3 in ...", "Figure 2", "MOESM2 of ..."
    r"|(?:table|figure|fig\.?|appendix|supplement\w*|additional file|moesm)\s*s?\d"
    r")"
    # "... for the paper", "... of the manuscript"
    r"|\b(?:for|from|of|in|accompanying|supporting|underlying)\s+(?:the\s+|this\s+|our\s+)?"
    r"(?:paper|manuscript|article|publication|preprint|thesis)\b",
    re.I,
)

# Hubs hold re-uploads of sources whose own terms restrict copying or commercial use, or that need
# a signed agreement. The uploader's licence label cannot be trusted there, so a hub record that
# names one of these sources in its title is dropped. The sources themselves are described in
# sources.md.
RESTRICTED_REHOST = re.compile(
    r"\b(kegg|drug\s?bank|cosmic|mimic[\s-]?(iii|iv|cxr|3|4)?|omim|hgmd|transfac|umls|snomed|meddra|"
    r"webmd|drugs\.com|uk\s?biobank|reaxys|scifinder|cas\s+registry|personal\s+genome|my\s+complete\s+genome)\b",
    re.I,
)
HUB_SOURCES = ("huggingface", "kaggle", "zenodo", "figshare", "dryad", "dataverse", "openml", "github", "mendeley-data", "datacite")


def study_accessions(*texts: Any) -> List[str]:
    found: List[str] = []
    for text in texts:
        if text:
            found.extend(m.group(1) for m in STUDY_ACCESSION.finditer(str(text)))
    return sorted(set(found))


def boundary_reason(record: Dict[str, Any]) -> Optional[str]:
    """Why a record must not enter the catalogue, or None when it may."""
    fields = [record.get(k) for k in ("id", "name", "url", "landing_api", "description", "citation")]
    for value in fields:
        if value and BENCHMARK.search(str(value)):
            return "benchmark: the record names the benchmark"
    if BENCHMARK_MAKERS.match(str(record.get("id", ""))):
        return "benchmark: a hub dataset from the account of the benchmark's makers"
    accessions = study_accessions(*fields)
    if accessions:
        return "study accession: " + ", ".join(accessions[:3])
    if record.get("level", "dataset") == "dataset" and PAPER_SUPPLEMENT.search(str(record.get("name", ""))):
        return "paper supplement: the title names the data of one paper"
    if record.get("source") in HUB_SOURCES:
        hit = RESTRICTED_REHOST.search(str(record.get("name", "")).replace("_", " ").replace("-", " "))
        if hit:
            return "restricted source re-hosted on a hub: " + hit.group(1)
    return None


# How many records the boundary rules dropped in this process, by rule. Fetchers report it.
BOUNDARY_DROPS: Dict[str, int] = {}


def allowed(record: Dict[str, Any]) -> bool:
    """True when the record may enter the catalogue. A refusal is counted in BOUNDARY_DROPS."""
    reason = boundary_reason(record)
    if reason is None:
        return True
    rule = reason.split(":", 1)[0]
    BOUNDARY_DROPS[rule] = BOUNDARY_DROPS.get(rule, 0) + 1
    return False


# ---------------------------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------------------------


def validate(record: Dict[str, Any]) -> List[str]:
    problems: List[str] = []
    for key in REQUIRED:
        if key not in record:
            problems.append(f"missing field {key}")
    for key in record:
        if key not in REQUIRED and key not in OPTIONAL:
            problems.append(f"unexpected field {key}")
    if problems:
        return problems

    def text(key: str, allow_none: bool = False, max_len: int = 500) -> None:
        value = record[key]
        if value is None:
            if not allow_none:
                problems.append(f"{key} is null")
            return
        if not isinstance(value, str) or not value.strip():
            problems.append(f"{key} must be a non-empty string")
        elif len(value) > max_len:
            problems.append(f"{key} is longer than {max_len} characters")
        elif re.search(r"[\x00-\x1f\x7f]", value):
            problems.append(f"{key} holds a control character or a line break")

    for key in ("id", "name", "source", "modality", "format", "licence", "how_retrieved"):
        text(key)
    text("description", max_len=MAX_DESCRIPTION)
    for key in ("landing_api", "size", "citation", "last_updated"):
        text(key, allow_none=True)
    if isinstance(record["id"], str) and not _ID.match(record["id"]):
        problems.append("id must look like <source>:<native id>")
    if isinstance(record["url"], str):
        if not _URL.match(record["url"]):
            problems.append("url must be an http(s) URL")
    else:
        problems.append("url must be a string")
    if record["landing_api"] is not None and not _URL.match(str(record["landing_api"])):
        problems.append("landing_api must be an http(s) URL or null")
    domains = record["domains"]
    if not isinstance(domains, list) or not domains:
        problems.append("domains must be a non-empty list")
    else:
        for domain in domains:
            if domain not in DOMAINS:
                problems.append(f"unknown domain {domain!r}")
        if domains != sorted(set(domains)):
            problems.append("domains must be sorted and unique")
    if record["access"] not in ACCESS:
        problems.append(f"access must be one of {ACCESS} (gated entries are excluded)")
    if record["commercial_use"] not in COMMERCIAL:
        problems.append(f"commercial_use must be one of {COMMERCIAL}")
    if not isinstance(record["share_alike"], bool):
        problems.append("share_alike must be true or false")
    if record["last_updated"] is not None and not _DATE.match(str(record["last_updated"])):
        problems.append("last_updated must be YYYY, YYYY-MM or YYYY-MM-DD")
    if not _STAMP.match(str(record["retrieved_at"])):
        problems.append("retrieved_at must be an ISO time in UTC, like 2026-01-31T12:00:00Z")
    if record.get("level") is not None and record["level"] not in LEVELS:
        problems.append(f"level must be one of {LEVELS}")
    if "signals" in record and not (
        isinstance(record["signals"], dict)
        and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in record["signals"].values())
    ):
        problems.append("signals must map names to numbers")
    if "same_as" in record and not (
        isinstance(record["same_as"], list) and all(isinstance(v, str) and _ID.match(v) for v in record["same_as"])
    ):
        problems.append("same_as must be a list of record ids")
    for key in ("licence_raw", "licence_source", "fetcher", "notes"):
        if key in record and record[key] is not None and not isinstance(record[key], str):
            problems.append(f"{key} must be a string")
    if (
        isinstance(record["licence"], str)
        and record["commercial_use"] in COMMERCIAL
        and isinstance(record["share_alike"], bool)
    ):
        clash = licences.check_consistent(record["licence"], record["commercial_use"], record["share_alike"])
        if clash:
            problems.append(clash)
        if record["licence"] == licences.UNKNOWN and record["commercial_use"] != "unclear":
            problems.append("an unknown licence must have commercial_use 'unclear'")
    if isinstance(record["description"], str) and common.is_instruction_like(record["description"]):
        problems.append("description reads like instructions to the reader (untrusted text)")
    reason = boundary_reason(record)
    if reason:
        problems.append("boundary: " + reason)
    return problems


def doi_of(value: Optional[str]) -> Optional[str]:
    """The bare, lower-case DOI in a citation string, or None."""
    if not value:
        return None
    match = re.search(r"(10\.\d{4,9}/[^\s\"<>]+)", value)
    if not match:
        return None
    return match.group(1).rstrip(".,;)").lower()


def make_record(
    *,
    id: str,
    name: str,
    source: str,
    url: str,
    domains: Sequence[str],
    modality: str,
    description: str,
    licence_raw: Any,
    retrieved_at: str,
    how_retrieved: str,
    fetcher: str,
    landing_api: Optional[str] = None,
    size: Optional[str] = None,
    format: Optional[str] = None,
    access: str = "open",
    citation: Optional[str] = None,
    last_updated: Optional[str] = None,
    level: str = "dataset",
    licence_url: Optional[str] = None,
    licence_source: Optional[str] = None,
    signals: Optional[Dict[str, float]] = None,
    notes: Optional[str] = None,
    same_as: Optional[Sequence[str]] = None,
    commercial_use: Optional[str] = None,
    share_alike: Optional[bool] = None,
) -> Dict[str, Any]:
    """Build a record. The licence fields always come from licences.normalise().

    commercial_use and share_alike may be given only for a licence that has no SPDX identifier
    (a provider's own terms), and only as the provider's terms state them.
    """
    licence = licences.normalise(licence_raw, licence_url)
    commercial = licence.commercial_use
    share = licence.share_alike
    if not licence.spdx and licence.id != licences.UNKNOWN:
        if commercial_use is not None:
            commercial = commercial_use
        if share_alike is not None:
            share = share_alike
    raw_text: Optional[str]
    if licence_raw is None or licence_raw == "" or licence_raw == []:
        raw_text = None
    elif isinstance(licence_raw, str):
        raw_text = licence_raw.strip()[:200]
    else:
        raw_text = "; ".join(str(v) for v in licence_raw)[:200]
    record: Dict[str, Any] = {
        "id": id,
        "name": name.strip()[:200],
        "source": source,
        "url": url,
        "landing_api": landing_api,
        "domains": sorted(set(domains)),
        "modality": modality or "unspecified",
        "description": description,
        "size": size,
        "format": format or "unknown",
        "licence": licence.id,
        "access": access,
        "commercial_use": commercial,
        "share_alike": share,
        "citation": citation,
        "last_updated": last_updated,
        "retrieved_at": retrieved_at,
        "how_retrieved": how_retrieved,
        "level": level,
        "fetcher": fetcher,
    }
    if raw_text and raw_text != licence.id:
        record["licence_raw"] = raw_text
    if licence_source:
        record["licence_source"] = licence_source[:300]
    if signals:
        record["signals"] = {k: v for k, v in sorted(signals.items()) if v is not None}
    if notes:
        record["notes"] = common.clean_text(notes, 600)
    if same_as:
        record["same_as"] = sorted(set(same_as))
    return record
