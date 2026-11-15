#!/usr/bin/env python3
"""openFDA: one record per downloadable endpoint (drug adverse events, labels, NDC, recalls, ...).

Endpoint: GET https://api.fda.gov/download.json (the official list of bulk download files).
The licence is read from https://open.fda.gov/license/ : the record gets CC0-1.0 only if that
page still says so.
Output: /tmp/dataset-scout/records/openfda.jsonl
"""

from __future__ import annotations

import re
import sys
from typing import Any, Dict, List, Optional

import common
import schema

SOURCE = "openfda"
INDEX = "https://api.fda.gov/download.json"
LICENCE_PAGES = ("https://open.fda.gov/license/", "https://open.fda.gov/terms/")
LICENCE_REGEX = r"Creative Commons CC0 1\.0 Universal|CC0 1\.0 Universal dedication"
LICENCE_PATTERN = re.compile(LICENCE_REGEX, re.I)

# What each endpoint holds, in our words. An endpoint that is not listed gets a generic line.
ABOUT: Dict[str, Dict[str, Any]] = {
    "drug/event": {"what": "FDA Adverse Event Reporting System (FAERS) reports for drugs and therapeutic biologics", "domains": ["pharmacovigilance", "drug-discovery", "clinical"]},
    "drug/label": {"what": "Structured product labelling (package inserts) for prescription and over-the-counter drugs", "domains": ["drug-discovery", "clinical", "text-literature"]},
    "drug/ndc": {"what": "National Drug Code directory of marketed drug products", "domains": ["drug-discovery", "clinical"]},
    "drug/enforcement": {"what": "Drug recall enforcement reports", "domains": ["pharmacovigilance", "clinical"]},
    "drug/drugsfda": {"what": "Drugs@FDA: approved drug products, applications and submissions", "domains": ["drug-discovery", "clinical"]},
    "drug/shortages": {"what": "Drug shortage records", "domains": ["clinical"]},
    "device/event": {"what": "Medical device adverse event reports (MAUDE)", "domains": ["pharmacovigilance", "clinical"]},
    "animalandveterinary/event": {"what": "Adverse event reports for animal drugs", "domains": ["pharmacovigilance", "toxicology"]},
    "food/event": {"what": "CAERS adverse event reports for foods, dietary supplements and cosmetics", "domains": ["pharmacovigilance", "toxicology"]},
    "other/substance": {"what": "FDA Global Substance Registration System (GSRS) substance records with structures and identifiers", "domains": ["chemistry", "drug-discovery"]},
    "other/unii": {"what": "Unique Ingredient Identifier (UNII) list", "domains": ["chemistry", "drug-discovery"]},
    "other/nsde": {"what": "NDC to SPL data elements file", "domains": ["drug-discovery", "clinical"]},
    "tobacco/problem": {"what": "Tobacco product problem reports", "domains": ["toxicology", "clinical"]},
    "drug/orangebook": {"what": "Orange Book: approved drug products with therapeutic equivalence evaluations, patents and exclusivity", "domains": ["drug-discovery", "clinical"]},
    "cosmetic/event": {"what": "Adverse event reports for cosmetic products", "domains": ["pharmacovigilance", "toxicology"]},
    "transparency/crl": {"what": "Complete response letters that the FDA sent for drug applications", "domains": ["drug-discovery", "clinical", "text-literature"]},
    "research/covidmirnaandproteomics": {"what": "FDA research data on COVID-19 miRNA and proteomics", "domains": ["proteomics", "transcriptomics"]},
}
# Endpoints outside drug review and biology (device registrations, tobacco advertising studies,
# food recalls) are left out.
KEEP = set(ABOUT)


def licence_from_pages() -> Optional[str]:
    """'CC0-1.0' when openFDA's own licence or terms page still states it; else None."""
    for url in LICENCE_PAGES:
        try:
            page = common.clean_text(common.fetch(url).text(), 10 ** 7)
        except Exception as err:
            common.log(f"{SOURCE}: could not read {url}: {err}")
            continue
        if LICENCE_PATTERN.search(page):
            return url
    return None


def to_records(index: Dict[str, Any], licence_url: Optional[str], retrieved_at: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    exported = (index.get("meta") or {}).get("last_updated")
    for category, endpoints in sorted((index.get("results") or {}).items()):
        if not isinstance(endpoints, dict):
            continue
        for endpoint, info in sorted(endpoints.items()):
            if not isinstance(info, dict) or "partitions" not in info:
                continue
            key = f"{category}/{endpoint}"
            if key not in KEEP:
                continue
            about = ABOUT[key]
            partitions = info.get("partitions") or []
            total_mb = sum(float(p.get("size_mb") or 0) for p in partitions)
            records = info.get("total_records")
            zipped = f"{total_mb / 1000:.1f} GB" if total_mb >= 1000 else f"{total_mb:.0f} MB"
            size = f"{records:,} records; {len(partitions)} files, {zipped} zipped" if records else None
            out.append(
                schema.make_record(
                    id=f"openfda:{key}",
                    name=f"openFDA {key}",
                    source=SOURCE,
                    url=f"https://open.fda.gov/apis/{key}/",
                    landing_api=f"https://api.fda.gov/{key}.json",
                    domains=about["domains"],
                    modality="tabular records (JSON)",
                    description=common.clean_text(
                        f"{about['what']}. Served by the openFDA API and as bulk JSON files. "
                        "The FDA says the data are not validated for clinical decisions.", 390),
                    size=size,
                    format="JSON (zipped), REST API",
                    licence_raw="CC0-1.0" if licence_url else None,
                    licence_source=f"{licence_url} matches /{LICENCE_REGEX}/" if licence_url else None,
                    last_updated=info.get("export_date") or exported,
                    retrieved_at=retrieved_at,
                    how_retrieved="GET " + INDEX,
                    fetcher="fetch_openfda.py",
                    level="collection",
                    notes="Anonymous API use is limited to 240 requests per minute and 1,000 per day per IP address.",
                )
            )
    return out


def main() -> int:
    index, got = common.get_json(INDEX)
    records = to_records(index, licence_from_pages(), got.fetched_at)
    common.write_records(SOURCE, records, drops=schema.BOUNDARY_DROPS)
    return 0


if __name__ == "__main__":
    sys.exit(main())
