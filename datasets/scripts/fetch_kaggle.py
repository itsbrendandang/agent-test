#!/usr/bin/env python3
"""Kaggle: public dataset metadata that the list endpoint returns without a login.

Endpoint: GET https://www.kaggle.com/api/v1/datasets/list?search=<words>&sortBy=votes&page=<n>
No key is sent. Only metadata is read; nothing is downloaded. Kept: datasets with a stated
licence, a usability rating of at least 0.7 and at least 30 votes, whose title names a
biology or chemistry data type.
Output: /tmp/dataset-scout/records/kaggle.jsonl
"""

from __future__ import annotations

import sys
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple

import common
import schema
import tagging

SOURCE = "kaggle"
API = "https://www.kaggle.com/api/v1/datasets/list"
QUERIES = [
    "drug discovery", "molecules smiles", "bioactivity", "toxicity molecules", "admet", "protein structure",
    "protein sequence", "genomics", "gene expression", "single cell rna", "rna-seq", "proteomics",
    "metabolomics", "chembl", "drug side effects", "clinical trials", "cancer genomics", "dna sequence",
    "chemistry dataset", "qm9", "binding affinity", "antibody", "crispr", "microbiome", "enzyme",
]
PAGES = 2
MIN_VOTES = 30
# The title or subtitle must name one of these domains. "drug" or "cancer" alone is not enough:
# on Kaggle those words mostly mark reviews, statistics and survey tables.
STRONG = {
    "admet", "toxicology", "bioactivity", "structural-biology", "quantum-chemistry", "reactions-synthesis",
    "single-cell", "transcriptomics", "epigenomics", "genomics", "proteomics", "metabolomics", "protein",
    "perturbation", "pathways-networks", "multi-omics",
}
NOTE = "The licence is the uploader's label on Kaggle. For a copy of third-party data, check the original source."
MIN_USABILITY = 0.7


def page_url(query: str, page: int) -> str:
    return API + "?" + urllib.parse.urlencode({"search": query, "sortBy": "votes", "page": str(page)})


def to_record(item: Dict[str, Any], retrieved_at: str, how: str) -> Optional[Dict[str, Any]]:
    ref = item.get("ref") or ""
    title = (item.get("title") or "").strip()
    if "/" not in ref or not title or item.get("isPrivate"):
        return None
    licence_name = (item.get("licenseName") or "").strip()
    if not licence_name or licence_name.lower() == "unknown":
        return None
    if int(item.get("voteCount") or 0) < MIN_VOTES or float(item.get("usabilityRating") or 0) < MIN_USABILITY:
        return None
    tags = [t.get("name", "") for t in item.get("tags") or []]
    subtitle = (item.get("subtitle") or "").strip()
    description = common.clean_text(subtitle or item.get("description") or title, 300)
    texts = [title, subtitle, ", ".join(tags)]
    domains = tagging.domains_for(texts)
    spoken = set(tagging.domains_for([title, subtitle], fallback=()))
    if not spoken & STRONG and not ("drug-discovery" in spoken and spoken & {"chemistry", "protein"}):
        return None
    return schema.make_record(
        id="kaggle:" + ref,
        name=title,
        source=SOURCE,
        url="https://www.kaggle.com/datasets/" + ref,
        landing_api=API + "?" + urllib.parse.urlencode({"search": title}),
        domains=domains,
        modality=tagging.modality_for(texts),
        description=description,
        size=common.human_size(item.get("totalBytes")),
        licence_raw=licence_name,
        licence_source="Kaggle list endpoint, field licenseName",
        last_updated=(item.get("lastUpdated") or "")[:10] or None,
        retrieved_at=retrieved_at,
        how_retrieved=how,
        fetcher="fetch_kaggle.py",
        notes=NOTE,
        signals={
            "votes": int(item.get("voteCount") or 0),
            "downloads": int(item.get("downloadCount") or 0),
            "usability": round(float(item.get("usabilityRating") or 0), 2),
        },
    )


def select(items: List[Tuple[Dict[str, Any], str, str]]) -> List[Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for item, retrieved_at, how in items:
        record = to_record(item, retrieved_at, how)
        if record and schema.allowed(record) and record["id"] not in out:
            out[record["id"]] = record
    return sorted(out.values(), key=lambda r: r["id"])


def main() -> int:
    items: List[Tuple[Dict[str, Any], str, str]] = []
    for query in QUERIES:
        for page in range(1, PAGES + 1):
            data, got = common.get_json(page_url(query, page))
            how = f"GET {API}?search={query}&sortBy=votes (pages 1-{PAGES})"
            items.extend((item, got.fetched_at, how) for item in data)
            if len(data) < 20:
                break
    records = select(items)
    common.log(f"{SOURCE}: {len(items)} list items, {len(records)} kept")
    common.write_records(SOURCE, records, drops=schema.BOUNDARY_DROPS)
    return 0


if __name__ == "__main__":
    sys.exit(main())
