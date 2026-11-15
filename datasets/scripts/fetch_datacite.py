#!/usr/bin/env python3
"""Named reference datasets on Zenodo, Figshare, Dryad, Dataverse and similar, read from DataCite.

Why DataCite: Zenodo's own API path is disallowed in its robots.txt, figshare.com and
dataverse.harvard.edu answer scripts with a bot challenge, and DataCite holds the registered
metadata of all of them (title, description, rights with SPDX identifiers, sizes, dates).

Why a pinned list: these repositories hold mostly the data of single papers. A keyword harvest
returns thousands of such deposits and no reliable sign of reuse. So scripts/seeds/datacite_dois.json
names well-known, reusable datasets by DOI, each with a word that must be in the title.
Endpoint: GET https://api.datacite.org/dois/<doi>
Output: /tmp/dataset-scout/records/datacite.jsonl
"""

from __future__ import annotations

import json
import sys
import urllib.parse
from pathlib import Path
from typing import Any, Dict, List, Optional

import common
import schema
import tagging

API = "https://api.datacite.org/dois/"
SEEDS = Path(__file__).with_name("seeds") / "datacite_dois.json"

# DataCite client id prefix or DOI prefix -> our source key
SOURCES = [
    ("cern.zenodo", "zenodo"), ("figshare.", "figshare"), ("dryad.", "dryad"), ("gdcc.harvard-dv", "dataverse"),
]
DOI_PREFIX_SOURCES = {
    "10.5281": "zenodo", "10.6084": "figshare", "10.25452": "figshare", "10.23645": "figshare",
    "10.5061": "dryad", "10.7910": "dataverse", "10.17632": "mendeley-data",
}


def source_of(doi: str, client: str) -> str:
    for prefix, source in SOURCES:
        if client.startswith(prefix):
            return source
    return DOI_PREFIX_SOURCES.get(doi.split("/", 1)[0], "datacite")


def rights_of(attributes: Dict[str, Any]) -> List[str]:
    out: List[str] = []
    for right in attributes.get("rightsList") or []:
        value = right.get("rightsIdentifier") or right.get("rightsUri") or right.get("rights")
        if value:
            out.append(str(value))
    return out


def size_of(attributes: Dict[str, Any]) -> Optional[str]:
    for size in attributes.get("sizes") or []:
        text = str(size).strip()
        number = text.lower().replace("bytes", "").strip()
        if number.isdigit():
            return common.human_size(int(number))
        if text:
            return text[:60]
    return None


def to_record(seed: Dict[str, Any], data: Dict[str, Any], retrieved_at: str) -> Optional[Dict[str, Any]]:
    """A DataCite record as a catalogue record; None when it is not the dataset the seed means."""
    attributes = data.get("attributes") or {}
    doi = (attributes.get("doi") or "").lower()
    titles = [t.get("title", "") for t in attributes.get("titles") or []]
    title = common.clean_text(titles[0], 200) if titles else ""
    if not doi or not title or attributes.get("state") != "findable":
        return None
    if seed["expect"].lower() not in " ".join(titles).lower():
        return None  # the DOI resolves to something else: do not trust the seed
    client = (((data.get("relationships") or {}).get("client") or {}).get("data") or {}).get("id", "")
    source = seed.get("source") or source_of(doi, client)
    descriptions = [d.get("description", "") for d in attributes.get("descriptions") or [] if d.get("description")]
    description = common.clean_text(descriptions[0], 300) if descriptions else title
    description = common.safe_description(description, title)
    subjects = [s.get("subject", "") for s in attributes.get("subjects") or []]
    formats = [str(f) for f in attributes.get("formats") or [] if f]
    texts = [title, ", ".join(subjects), description]
    rights = rights_of(attributes)
    updated = (attributes.get("updated") or "")[:10] or (str(attributes.get("publicationYear") or "") or None)
    return schema.make_record(
        id=f"{source}:{doi}",
        name=seed.get("name") or title,
        source=source,
        url="https://doi.org/" + doi,
        landing_api=API + urllib.parse.quote(doi, safe="/"),
        domains=seed.get("domains") or tagging.domains_for(texts),
        modality=tagging.modality_for(texts),
        description=description,
        size=size_of(attributes),
        format=", ".join(sorted(set(formats))[:6]) if formats else None,
        licence_raw=rights or None,
        licence_source="DataCite metadata, field rightsList" if rights else None,
        citation="doi:" + doi,
        last_updated=updated,
        retrieved_at=retrieved_at,
        how_retrieved="GET " + API + doi + " (DOI pinned in scripts/seeds/datacite_dois.json)",
        fetcher="fetch_datacite.py",
        level="dataset",
        signals={"citations": int(attributes.get("citationCount") or 0)},
        notes=seed.get("note"),
    )


def main() -> int:
    seeds = json.loads(SEEDS.read_text(encoding="utf-8"))
    records: Dict[str, Dict[str, Any]] = {}
    for seed in seeds:
        doi = seed["doi"].lower()
        try:
            data, got = common.get_json(API + urllib.parse.quote(doi, safe="/"))
        except Exception as err:
            common.log(f"datacite: MISS {doi}: {err}")
            continue
        record = to_record(seed, data.get("data") or {}, got.fetched_at)
        if record is None:
            titles = [t.get("title", "") for t in ((data.get("data") or {}).get("attributes") or {}).get("titles") or []]
            common.log(f"datacite: SKIP {doi}: title {titles[:1]} does not hold {seed['expect']!r}")
            continue
        if not schema.allowed(record):
            common.log(f"datacite: DROP {doi}: {schema.boundary_reason(record)}")
            continue
        common.log(f"datacite: ok   {record['id']:<46} {record['licence'][:16]:<16} {record['name'][:60]}")
        records[record["id"]] = record
    common.write_records("datacite", list(records.values()), drops=schema.BOUNDARY_DROPS)
    return 0


if __name__ == "__main__":
    sys.exit(main())
