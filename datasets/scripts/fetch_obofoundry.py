#!/usr/bin/env python3
"""OBO Foundry: active biomedical ontologies with their licences.

Endpoint: GET https://obofoundry.org/registry/ontologies.jsonld (the registry's own export).
Kept: ontologies that are active and not obsolete. Agents use them for annotation and enrichment
(Gene Ontology, ChEBI, Cell Ontology, Uberon, Mondo, HPO, ...).
Output: /tmp/dataset-scout/records/obo-foundry.jsonl
"""

from __future__ import annotations

import sys
from typing import Any, Dict, List, Optional

import common
import licences
import schema
import tagging

SOURCE = "obo-foundry"
INDEX = "https://obofoundry.org/registry/ontologies.jsonld"


def licence_label(licence: Dict[str, Any]) -> Optional[str]:
    """The registry's licence label. A label that is not a known licence keeps its URL beside it."""
    label, url = (licence.get("label") or "").strip(), (licence.get("url") or "").strip()
    if not label:
        return url or None
    if licences.normalise(label, url).spdx or not url:
        return label
    return f"{label} licence, see {url}"


def to_record(item: Dict[str, Any], retrieved_at: str) -> Optional[Dict[str, Any]]:
    if item.get("activity_status") != "active" or item.get("is_obsolete"):
        return None
    prefix = (item.get("id") or "").strip()
    title = (item.get("title") or "").strip()
    if not prefix or not title:
        return None
    licence = item.get("license") or {}
    description = common.clean_text(item.get("description") or title, 300)
    products = [p.get("id", "") for p in item.get("products") or []]
    formats = sorted({p.rsplit(".", 1)[-1].upper() for p in products if "." in p})
    texts = [title, description, str(item.get("domain") or "")]
    domains = set(tagging.domains_for(texts, fallback=())) | {"ontology"}
    domains = {"ontology"} | set(sorted(domains - {"ontology"})[:4])
    return schema.make_record(
        id="obo:" + prefix,
        name=f"{title} ({item.get('preferredPrefix') or prefix.upper()})",
        source=SOURCE,
        url=f"https://obofoundry.org/ontology/{prefix}.html",
        landing_api=item.get("ontology_purl") or None,
        domains=sorted(domains),
        modality="ontology (terms and relations)",
        description=description,
        format=", ".join(formats) if formats else "OWL",
        licence_raw=licence_label(licence),
        licence_url=licence.get("url") or None,
        licence_source="OBO Foundry registry, field license",
        retrieved_at=retrieved_at,
        how_retrieved="GET " + INDEX,
        fetcher="fetch_obofoundry.py",
        level="dataset",
    )


def select(items: List[Dict[str, Any]], retrieved_at: str) -> List[Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for item in items:
        record = to_record(item, retrieved_at)
        if record and schema.allowed(record):
            out[record["id"]] = record
    return sorted(out.values(), key=lambda r: r["id"])


def main() -> int:
    data, got = common.get_json(INDEX, headers={"Accept": "application/ld+json, application/json"})
    records = select(data.get("ontologies") or [], got.fetched_at)
    common.log(f"{SOURCE}: {len(data.get('ontologies') or [])} ontologies, {len(records)} active")
    common.write_records(SOURCE, records, drops=schema.BOUNDARY_DROPS)
    return 0


if __name__ == "__main__":
    sys.exit(main())
