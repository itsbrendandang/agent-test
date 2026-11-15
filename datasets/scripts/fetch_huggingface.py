#!/usr/bin/env python3
"""Hugging Face Hub: ungated biology and chemistry datasets, from the public datasets API.

Endpoint: GET https://huggingface.co/api/datasets?filter=<tag>&sort=downloads&direction=-1
No token is sent. Gated, private and disabled datasets are left out.
Output: /tmp/dataset-scout/records/huggingface.jsonl
"""

from __future__ import annotations

import re
import sys
import urllib.parse
from typing import Any, Dict, Iterable, List, Optional, Tuple

import common
import schema
import tagging

SOURCE = "huggingface"
API = "https://huggingface.co/api/datasets"
FIELDS = ["tags", "downloads", "likes", "lastModified", "gated", "description", "private", "disabled", "createdAt", "author"]

# tag -> how many pages of 1000 to read at most (sorted by downloads, highest first)
TAGS: Dict[str, int] = {
    "biology": 4, "chemistry": 3, "medical": 1,
    "drug-discovery": 1, "protein": 1, "proteins": 1, "genomics": 1, "single-cell": 1,
    "bioinformatics": 1, "molecules": 1, "cheminformatics": 1, "transcriptomics": 1,
    "proteomics": 1, "metabolomics": 1, "dna": 1, "rna": 1, "smiles": 1, "admet": 1,
    "toxicology": 1, "pharmacology": 1, "molecular-dynamics": 1, "drug": 1, "genetics": 1,
    "protein-structure": 1, "antibody": 1, "scRNA-seq": 1, "cell-biology": 1,
}
STOP_BELOW_DOWNLOADS = 50  # stop paging a tag when a page ends below this

# Quality rules ("quality over padding"). A dataset is kept when
#   it has an explicit licence and some use (likes or downloads in the last 30 days), or
#   it has no usable licence tag but much use.
# Datasets that are mostly text for language models need more use, and one account can add at
# most MAX_PER_AUTHOR datasets (the most downloaded), so that a long series of splits by one
# account does not fill the catalogue.
MIN_DOWNLOADS = 300
MIN_LIKES = 2
MIN_DOWNLOADS_NO_LICENCE = 1500
MIN_LIKES_NO_LICENCE = 25
MIN_DOWNLOADS_TEXT = 1000
MIN_LIKES_TEXT = 5
MAX_PER_AUTHOR = 15

# Teasers, copies and placeholders are not datasets to rely on.
_NOT_A_DATASET = re.compile(
    r"\b(preview|sample[s]?|demo|toy|dummy|tutorial|placeholder|unofficial|mirror(ed)?|test[-_ ]?(data|set|upload)?)\b", re.I
)
# Radiology and other clinical imaging is outside "biology and chemistry".
_RADIOLOGY = re.compile(
    r"\bmri\b|\bct\b|ct[\s-]scan|x-?ray|radiolog|\bbrats|segmentation decathlon|\bmsd\b|ultrasound|mammogra|endoscop"
    r"|retina|fundus|dermato|chest|surgical|surgery|\bfaces?\b|facial", re.I
)

_STRUCTURAL = (
    "license:", "size_categories:", "format:", "modality:", "library:", "region:", "task_categories:",
    "task_ids:", "language:", "arxiv:", "doi:", "source_datasets:", "annotations_creators:",
    "language_creators:", "multilinguality:", "benchmark:", "paperswithcode_id:", "pretty_name:",
)
# Subject tags of general benchmarks. Three or more of them mean "a general benchmark that also
# has a biology or chemistry part", which is not what the catalogue is for.
_OFF_TOPIC = {
    "math", "mathematics", "physics", "finance", "legal", "law", "code", "history", "geography",
    "economics", "philosophy", "art", "music", "astronomy", "engineering", "computer-science",
    "politics", "business", "education", "psychology", "sports", "climate", "robotics", "agent",
    "synthetic", "roleplay", "not-for-all-audiences", "croissant", "datasets", "pandas", "polars",
}


def page_url(tag: str) -> str:
    query: List[Tuple[str, str]] = [("filter", tag), ("sort", "downloads"), ("direction", "-1"), ("limit", "1000")]
    query += [("expand[]", field) for field in FIELDS]
    return API + "?" + urllib.parse.urlencode(query)


def next_link(link_header: Optional[str]) -> Optional[str]:
    if not link_header:
        return None
    match = re.search(r'<([^>]+)>;\s*rel="next"', link_header)
    return match.group(1) if match else None


def tag_value(tags: Iterable[str], prefix: str) -> List[str]:
    return [t[len(prefix):] for t in tags if t.startswith(prefix)]


def clean_description(text: Optional[str], name: str) -> str:
    text = text or ""
    text = re.sub(r"…?\s*See the full description on the dataset page:\s*\S+", "", text)
    text = re.sub(r"Dataset Card for\s+[^\n]{0,120}", " ", text, flags=re.I)
    text = re.sub(r"\b(Dataset Summary|Dataset Description|Table of Contents|Overview)\b", " ", text)
    return common.clean_text(text, 300)


def to_record(item: Dict[str, Any], retrieved_at: str, how: str) -> Optional[Dict[str, Any]]:
    """One API item as a catalogue record, or None when the dataset is not eligible."""
    if item.get("private") or item.get("disabled") or item.get("gated") is not False:
        return None
    dataset_id = item.get("id") or ""
    if "/" not in dataset_id:
        return None
    tags = [str(t) for t in item.get("tags") or []]
    topical = [t for t in tags if not t.startswith(_STRUCTURAL)]
    name = dataset_id.split("/", 1)[1]
    raw_description = item.get("description") or ""
    description = clean_description(raw_description, name)
    # Relevance: the name or the description must speak of biology or chemistry, or at least
    # two of the dataset's own tags must. One generic tag is not enough.
    spoken = tagging.core_hits([name.replace("_", " ").replace("-", " "), description])
    tagged = tagging.core_hits([" , ".join(topical)])
    if spoken == 0 and tagged < 2:
        return None
    if len({t.lower() for t in topical} & _OFF_TOPIC) >= 3:
        return None
    if _NOT_A_DATASET.search(name.replace("_", " ").replace("-", " ")) or re.search(
        r"\bunofficial\b|\bmirror of\b|\d+-row preview", raw_description, re.I
    ):
        return None
    licence_tags = tag_value(tags, "license:")
    downloads = int(item.get("downloads") or 0)
    likes = int(item.get("likes") or 0)
    has_licence = any(t not in ("unknown", "other") for t in licence_tags)
    texts = [name.replace("_", " ").replace("-", " "), " , ".join(topical), description]
    domains = tagging.domains_for(texts)
    core = [d for d in domains if d in tagging.CORE]
    if _RADIOLOGY.search(" ".join(texts)) and set(core) <= {"cancer", "clinical-trials", "immunology", "variation"}:
        return None
    if not has_licence:
        if downloads < MIN_DOWNLOADS_NO_LICENCE and likes < MIN_LIKES_NO_LICENCE:
            return None
    elif "text-literature" in domains:
        if downloads < MIN_DOWNLOADS_TEXT and likes < MIN_LIKES_TEXT:
            return None
    elif downloads < MIN_DOWNLOADS and likes < MIN_LIKES:
        return None
    if not description:
        description = "No description on the dataset card. Tags: " + ", ".join(topical[:12])
        description = common.clean_text(description, 300)
    sizes = tag_value(tags, "size_categories:")
    formats = tag_value(tags, "format:")
    modalities = tag_value(tags, "modality:")
    doi = tag_value(tags, "doi:")
    arxiv = tag_value(tags, "arxiv:")
    citation = ("doi:" + doi[0]) if doi else ("arXiv:" + arxiv[0]) if arxiv else None
    last = (item.get("lastModified") or "")[:10] or None
    return schema.make_record(
        id="hf:" + dataset_id,
        name=dataset_id,
        source=SOURCE,
        url="https://huggingface.co/datasets/" + dataset_id,
        landing_api="https://huggingface.co/api/datasets/" + dataset_id,
        domains=domains,
        modality=tagging.modality_for(texts, stated=modalities),
        description=description,
        size=(sizes[0] + " rows") if sizes else None,
        format=", ".join(sorted(set(formats))) if formats else None,
        licence_raw=licence_tags if licence_tags else None,
        licence_source="Hugging Face dataset tag license:*" if licence_tags else None,
        citation=citation,
        last_updated=last,
        retrieved_at=retrieved_at,
        how_retrieved=how,
        fetcher="fetch_huggingface.py",
        signals={"downloads_30d": downloads, "likes": likes},
    )


def mirror_key(dataset_id: str) -> str:
    """Datasets re-uploaded under the same name by several accounts share this key."""
    return re.sub(r"[^a-z0-9]+", "", dataset_id.split("/", 1)[1].lower())


def select(items: Iterable[Tuple[Dict[str, Any], str, str]]) -> List[Dict[str, Any]]:
    """Records for the eligible items. Of re-uploads with one name, the most downloaded is kept."""
    best: Dict[str, Dict[str, Any]] = {}
    seen: set = set()
    for item, retrieved_at, how in items:
        if item.get("id") in seen:
            continue
        seen.add(item.get("id"))
        record = to_record(item, retrieved_at, how)
        if record is None or not schema.allowed(record):
            continue
        key = mirror_key(item["id"])
        current = best.get(key)
        rank = (record["signals"]["downloads_30d"], record["signals"]["likes"], record["id"])
        if current is None or rank > (
            current["signals"]["downloads_30d"], current["signals"]["likes"], current["id"]
        ):
            best[key] = record
    per_author: Dict[str, List[Dict[str, Any]]] = {}
    for record in best.values():
        per_author.setdefault(record["name"].split("/", 1)[0], []).append(record)
    kept: List[Dict[str, Any]] = []
    for author_records in per_author.values():
        author_records.sort(key=lambda r: (-r["signals"]["downloads_30d"], -r["signals"]["likes"], r["id"]))
        kept.extend(author_records[:MAX_PER_AUTHOR])
    return sorted(kept, key=lambda r: r["id"])


def harvest() -> List[Tuple[Dict[str, Any], str, str]]:
    out: List[Tuple[Dict[str, Any], str, str]] = []
    for tag, max_pages in TAGS.items():
        url: Optional[str] = page_url(tag)
        how = f"GET {API}?filter={tag}&sort=downloads&direction=-1&limit=1000 (paged by the Link header)"
        pages = 0
        while url and pages < max_pages:
            data, got = common.get_json(url)
            pages += 1
            for item in data:
                out.append((item, got.fetched_at, how))
            common.log(f"huggingface: tag {tag} page {pages}: {len(data)} items")
            if not data or int(data[-1].get("downloads") or 0) < STOP_BELOW_DOWNLOADS:
                break
            url = next_link(got.headers.get("link"))
    return out


def main() -> int:
    items = harvest()
    records = select(items)
    common.log(f"huggingface: {len({i[0].get('id') for i in items})} distinct datasets seen, {len(records)} kept")
    common.write_records(SOURCE, records, drops=schema.BOUNDARY_DROPS)
    return 0


if __name__ == "__main__":
    sys.exit(main())
