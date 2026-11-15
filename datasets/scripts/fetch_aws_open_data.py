#!/usr/bin/env python3
"""Registry of Open Data on AWS: biology and chemistry datasets.

Endpoint: GET https://registry.opendata.aws/roda/ndjson/index.ndjson (the registry's own bulk index).
Left out: deprecated entries, entries where every resource is controlled access, physiological
signal collections, clinical imaging, and earth-observation data that only carries a biology tag.
Output: /tmp/dataset-scout/records/aws-open-data.jsonl
"""

from __future__ import annotations

import json
import re
import sys
from typing import Any, Dict, List, Optional

import common
import schema
import tagging

SOURCE = "aws-open-data"
INDEX = "https://registry.opendata.aws/roda/ndjson/index.ndjson"

WANTED = {
    "biology", "bioinformatics", "genomic", "genetic", "chemistry", "chemical biology", "pharmaceutical",
    "proteomics", "proteomic", "metabolomics", "transcriptomics", "single-cell transcriptomics", "protein",
    "molecular docking", "cell biology", "cell imaging", "cell painting", "microbiome", "structural biology",
    "protein folding", "molecule", "drug discovery", "epigenomics", "whole genome sequencing",
    "whole exome sequencing", "cancer", "biomolecular modeling", "molecular dynamics", "amino acid",
    "cryo electron microscopy", "cryo electron tomography", "metagenomics", "phylogenetics", "fastq", "bam",
    "vcf", "microscopy", "immunology", "virus", "coronavirus",
}
NOT_WANTED = {
    "satellite imagery", "oceans", "earth observation", "climate", "weather", "geospatial", "atmosphere",
    "meteorological", "neuroimaging", "medical imaging", "electrophysiology", "eeg", "mri", "agriculture",
    "biodiversity", "ecosystems", "environmental", "radiology", "computed tomography", "x-ray",
}
SKIP_MANAGERS = ("physionet", "brain data science platform")
FORMAT_TAGS = ("parquet", "vcf", "bam", "cram", "fastq", "fast5", "zarr", "hdf5", "hdf", "csv", "json", "txt", "xml", "tiff", "netcdf", "bed")


def plain(text: Optional[str]) -> str:
    return re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text or "")


def to_record(row: Dict[str, Any], retrieved_at: str) -> Optional[Dict[str, Any]]:
    if row.get("Deprecated"):
        return None
    tags = [str(t) for t in row.get("Tags") or []]
    low = {t.lower() for t in tags}
    if not low & WANTED or low & NOT_WANTED:
        return None
    if any(word in (row.get("ManagedBy") or "").lower() for word in SKIP_MANAGERS):
        return None
    resources = row.get("Resources") or []
    if resources and all(res.get("ControlledAccess") for res in resources):
        return None  # gated
    name = (row.get("Name") or "").strip()
    slug = (row.get("Slug") or "").strip()
    if not name or not slug:
        return None
    description = common.safe_description(common.clean_text(plain(row.get("Description")), 300), name)
    texts = [name, ", ".join(tags), description]
    if tagging.core_hits([name, description]) == 0:
        return None
    notes: List[str] = []
    if any(res.get("ControlledAccess") for res in resources):
        notes.append("Some resources are controlled access; only the open ones count here.")
    if any(res.get("RequesterPays") for res in resources):
        notes.append("Some buckets are requester-pays: downloading costs money.")
    formats = [t for t in FORMAT_TAGS if t in low]
    citation = schema.doi_of(json.dumps(row.get("Citation") or ""))
    licence_text = (row.get("License") or "").strip()
    return schema.make_record(
        id="aws:" + slug,
        name=name,
        source=SOURCE,
        url=f"https://registry.opendata.aws/{slug}/",
        landing_api=INDEX,
        domains=tagging.domains_for(texts),
        modality=tagging.modality_for(texts),
        description=description or name,
        format=", ".join(formats) if formats else None,
        licence_raw=licence_text or None,
        licence_source="Registry of Open Data on AWS, field License",
        citation=("doi:" + citation) if citation else None,
        last_updated=(row.get("RegistryEntryLastModified") or "")[:10] or None,
        retrieved_at=retrieved_at,
        how_retrieved="GET " + INDEX,
        fetcher="fetch_aws_open_data.py",
        level="dataset",
        notes=" ".join(notes) or None,
    )


def select(rows: List[Dict[str, Any]], retrieved_at: str) -> List[Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        record = to_record(row, retrieved_at)
        if record and schema.allowed(record):
            out[record["id"]] = record
    return sorted(out.values(), key=lambda r: r["id"])


def main() -> int:
    got = common.fetch(INDEX)
    rows = [json.loads(line) for line in got.text().splitlines() if line.strip()]
    records = select(rows, got.fetched_at)
    common.log(f"{SOURCE}: {len(rows)} registry entries, {len(records)} kept")
    common.write_records(SOURCE, records, drops=schema.BOUNDARY_DROPS)
    return 0


if __name__ == "__main__":
    sys.exit(main())
