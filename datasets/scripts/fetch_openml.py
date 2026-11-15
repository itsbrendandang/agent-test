#!/usr/bin/env python3
"""OpenML: biology and chemistry datasets with their licence field.

NOT RUN YET. OpenML's robots.txt has a group that blocks AI agents, and this catalogue was first
built by one, so the script was written from the API documentation and tested only on a
hand-made fixture. A person may run it (DATASET_SCOUT_OPERATOR=human): the first run should be
read with care, and a recorded fixture should replace the hand-made one.

Endpoints (https://www.openml.org/apidoc/):
  GET https://www.openml.org/api/v1/json/data/list/tag/<tag>/status/active/limit/<n>
  GET https://www.openml.org/api/v1/json/data/<id>      (licence, description, dates)
The ~16,000 "QSAR-TID-*" tables made from ChEMBL are left out on purpose: they are one series.
Output: /tmp/dataset-scout/records/openml.jsonl
"""

from __future__ import annotations

import re
import sys
from typing import Any, Dict, List, Optional

import common
import schema
import tagging

SOURCE = "openml"
API = "https://www.openml.org/api/v1/json"
TAGS = ["Chemistry", "Life Science", "Biology", "Genomics", "Medicine", "chemistry", "biology", "drug-discovery"]
PER_TAG = 200
MAX_DETAILS = 300
MIN_ROWS = 100
_SERIES = re.compile(r"^QSAR-TID-\d+|^qsar-", re.I)


def qualities(item: Dict[str, Any]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for quality in item.get("quality") or []:
        try:
            out[quality["name"]] = float(quality["value"])
        except (KeyError, TypeError, ValueError):
            continue
    return out


def to_record(item: Dict[str, Any], detail: Dict[str, Any], retrieved_at: str) -> Optional[Dict[str, Any]]:
    """item is one row of data/list; detail is data_set_description of data/<id>."""
    did = str(item.get("did") or detail.get("id") or "")
    name = (detail.get("name") or item.get("name") or "").strip()
    if not did or not name or _SERIES.search(name) or item.get("status", "active") != "active":
        return None
    numbers = qualities(item)
    rows, columns = int(numbers.get("NumberOfInstances", 0)), int(numbers.get("NumberOfFeatures", 0))
    if rows < MIN_ROWS:
        return None
    description = common.safe_description(common.clean_text(detail.get("description"), 300), "")
    tags = detail.get("tag") or []
    tags = [tags] if isinstance(tags, str) else [str(t) for t in tags]
    texts = [name.replace("_", " ").replace("-", " "), description, ", ".join(tags)]
    if tagging.core_hits([texts[0], description]) == 0:
        return None
    licence = (detail.get("licence") or "").strip() or None
    return schema.make_record(
        id="openml:" + did,
        name=f"{name} (OpenML {did})",
        source=SOURCE,
        url="https://www.openml.org/d/" + did,
        landing_api=f"{API}/data/{did}",
        domains=tagging.domains_for(texts),
        modality="tabular",
        description=description or name,
        size=f"{rows:,} rows x {columns:,} columns" if columns else f"{rows:,} rows",
        format=str(detail.get("format") or item.get("format") or "ARFF"),
        licence_raw=licence,
        licence_source="OpenML data description, field licence" if licence else None,
        last_updated=(detail.get("upload_date") or "")[:10] or None,
        retrieved_at=retrieved_at,
        how_retrieved=f"GET {API}/data/list/tag/<tag> and GET {API}/data/{did}",
        fetcher="fetch_openml.py",
        signals={"rows": rows},
    )


def main() -> int:
    listed: Dict[str, Dict[str, Any]] = {}
    for tag in TAGS:
        url = f"{API}/data/list/tag/{tag}/status/active/limit/{PER_TAG}"
        try:
            data, _ = common.get_json(url, ok_statuses=(200,))
        except common.RobotsDisallowed:
            common.log(f"{SOURCE}: robots.txt disallows the API for this operator; nothing fetched")
            return 2
        except common.HttpError as err:
            common.log(f"{SOURCE}: tag {tag}: {err}")  # OpenML answers 412 when a tag has no dataset
            continue
        for item in ((data.get("data") or {}).get("dataset") or []):
            listed.setdefault(str(item.get("did")), item)
    records: List[Dict[str, Any]] = []
    for did in sorted(listed, key=int)[:MAX_DETAILS]:
        try:
            data, got = common.get_json(f"{API}/data/{did}")
        except Exception as err:
            common.log(f"{SOURCE}: data {did}: {err}")
            continue
        record = to_record(listed[did], data.get("data_set_description") or {}, got.fetched_at)
        if record and schema.allowed(record):
            records.append(record)
    common.write_records(SOURCE, records, drops=schema.BOUNDARY_DROPS)
    return 0


if __name__ == "__main__":
    sys.exit(main())
