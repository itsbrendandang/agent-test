#!/usr/bin/env python3
"""Bioregistry: life-science databases that state a licence.

Endpoint: GET https://raw.githubusercontent.com/biopragmatics/bioregistry/main/exports/registry/registry.json
(the registry's own export; its metadata is CC0-1.0).
Kept: resources that are not deprecated, are not a part of another resource, are not an OBO
Foundry ontology (fetch_obofoundry.py lists those), have a homepage and a description, and whose
licence the registry gives as an SPDX identifier.
Output: /tmp/dataset-scout/records/bioregistry.jsonl
"""

from __future__ import annotations

import re
import sys
from typing import Any, Dict, List, Optional

import common
import licences
import schema
import tagging

SOURCE = "bioregistry"
INDEX = "https://raw.githubusercontent.com/biopragmatics/bioregistry/main/exports/registry/registry.json"
KEEP_ONTOLOGIES = {"efo", "orpha", "biolink", "ec", "icdo", "bao", "aopo", "edam", "mesh", "sio"}
_VOCABULARY = re.compile(r"ontolog|vocabular|thesaurus|terminolog|\bschema\b|knowledge graph registry|core model", re.I)


def to_record(prefix: str, item: Dict[str, Any], retrieved_at: str) -> Optional[Dict[str, Any]]:
    if item.get("deprecated") or item.get("part_of") or item.get("has_canonical") or item.get("provides"):
        return None
    if "obofoundry" in (item.get("mappings") or {}):
        return None
    name = (item.get("name") or "").strip()
    homepage = (item.get("homepage") or "").strip()
    description = common.clean_text(item.get("description"), 300)
    if not name or not homepage.startswith(("http://", "https://")) or len(description) < 40:
        return None
    licence = licences.normalise(item.get("license"))
    if not licence.spdx:
        return None
    keywords = [str(k) for k in item.get("keywords") or []]
    texts = [name, description, ", ".join(keywords)]
    if tagging.core_hits(texts) == 0:
        return None
    domains = set(tagging.domains_for(texts))
    is_ontology = bool(_VOCABULARY.search(name) or _VOCABULARY.search(description[:80]))
    if is_ontology:
        # This fetcher is for databases. Ontologies come from the OBO Foundry fetcher; a few
        # widely used ones that are not in the OBO Foundry are kept.
        if prefix.split(".", 1)[0] not in KEEP_ONTOLOGIES:
            return None
        domains = set(sorted(domains)[:4]) | {"ontology"}
    publications = item.get("publications") or []
    doi = next((p.get("doi") for p in publications if p.get("doi")), None)
    return schema.make_record(
        id="bioregistry:" + prefix,
        name=name,
        source=SOURCE,
        url=homepage,
        landing_api="https://bioregistry.io/api/registry/" + prefix,
        domains=sorted(domains),
        modality="database (identifiers and records)",
        description=description,
        licence_raw=item.get("license"),
        licence_source="Bioregistry, field license (curated by the registry, not re-read at the provider)",
        citation=("doi:" + doi.lower()) if doi else None,
        retrieved_at=retrieved_at,
        how_retrieved="GET " + INDEX,
        fetcher="fetch_bioregistry.py",
        level="repository",
    )


def select(registry: Dict[str, Dict[str, Any]], retrieved_at: str) -> List[Dict[str, Any]]:
    """One record per resource. The registry often has several identifier namespaces for one
    database ("civic.gid", "civic.eid", ...): the one with the shortest prefix stands for all."""
    by_root: Dict[str, List[Dict[str, Any]]] = {}
    for prefix in sorted(registry):
        record = to_record(prefix, registry[prefix], retrieved_at)
        if record and schema.allowed(record):
            by_root.setdefault(prefix.split(".", 1)[0], []).append(record)
    out: List[Dict[str, Any]] = []
    for root in sorted(by_root):
        group = sorted(by_root[root], key=lambda r: (len(r["id"]), r["id"]))
        chosen = group[0]
        if len(group) > 1:
            chosen["notes"] = f"Bioregistry lists {len(group)} identifier namespaces for this resource; this record stands for all."
        out.append(chosen)
    return out


def main() -> int:
    registry, got = common.get_json(INDEX)
    records = select(registry, got.fetched_at)
    common.log(f"{SOURCE}: {len(registry)} registry entries, {len(records)} kept")
    common.write_records(SOURCE, records, drops=schema.BOUNDARY_DROPS)
    return 0


if __name__ == "__main__":
    sys.exit(main())
