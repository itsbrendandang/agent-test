#!/usr/bin/env python3
"""Therapeutics Data Commons (TDC): one record per dataset, read from the TDC documentation.

TDC has no listing API. Its documentation pages are the official list: each dataset has a
section with a description, statistics, the loader name and a "Dataset License" line.
Endpoints: GET https://tdcommons.ai/overview/ (to find the task pages), then each task page.
Output: /tmp/dataset-scout/records/tdc.jsonl
"""

from __future__ import annotations

import re
import sys
from typing import Any, Dict, List, Optional, Tuple

import common
import schema
import tagging

SOURCE = "tdc"
SITE = "https://tdcommons.ai"
OVERVIEW = SITE + "/overview/"
# Used when the overview page cannot be read, so the fetcher still works from the cache.
KNOWN_PAGES = [
    "single_pred_tasks/adme", "single_pred_tasks/tox", "single_pred_tasks/hts", "single_pred_tasks/qm",
    "single_pred_tasks/yields", "single_pred_tasks/paratope", "single_pred_tasks/epitope",
    "single_pred_tasks/develop", "multi_pred_tasks/dti", "multi_pred_tasks/ddi", "multi_pred_tasks/ppi",
    "multi_pred_tasks/gdi", "multi_pred_tasks/drugres", "multi_pred_tasks/drugsyn",
    "multi_pred_tasks/peptidemhc", "multi_pred_tasks/antibodyaff", "multi_pred_tasks/mti",
    "multi_pred_tasks/catalyst", "multi_pred_tasks/trialoutcome", "generation_tasks/molgen",
    "generation_tasks/retrosyn",
]
PAGE_DOMAINS: Dict[str, List[str]] = {
    "adme": ["admet", "chemistry", "drug-discovery"],
    "tox": ["toxicology", "admet", "chemistry", "drug-discovery"],
    "hts": ["bioactivity", "chemistry", "drug-discovery"],
    "qm": ["quantum-chemistry", "chemistry"],
    "yields": ["reactions-synthesis", "chemistry"],
    "paratope": ["immunology", "protein"],
    "epitope": ["immunology", "protein"],
    "develop": ["immunology", "protein", "drug-discovery"],
    "dti": ["bioactivity", "drug-discovery", "protein", "chemistry"],
    "ddi": ["drug-discovery", "pharmacovigilance", "chemistry"],
    "ppi": ["pathways-networks", "protein"],
    "gdi": ["genomics", "variation", "medical"],
    "drugres": ["perturbation", "cancer", "drug-discovery"],
    "drugsyn": ["perturbation", "cancer", "drug-discovery"],
    "peptidemhc": ["immunology", "protein"],
    "antibodyaff": ["immunology", "protein", "drug-discovery"],
    "mti": ["genomics", "transcriptomics"],
    "catalyst": ["reactions-synthesis", "chemistry"],
    "trialoutcome": ["clinical-trials", "drug-discovery"],
    "molgen": ["chemistry", "drug-discovery"],
    "retrosyn": ["reactions-synthesis", "chemistry"],
    "crispr_outcome": ["genomics", "perturbation"],
    "tcrepitope": ["immunology", "protein"],
}
NOT_SPECIFIED = "Not specified by the original source; TDC distributes it under CC BY 4.0"


def strip_tags(html: str) -> str:
    return common.clean_text(html, 2000)


def field(section: str, label: str) -> str:
    match = re.search(r"<strong>\s*" + re.escape(label) + r"\s*:?\s*</strong>(.*?)</p>", section, flags=re.S | re.I)
    return strip_tags(match.group(1)) if match else ""


def licence_of(section: str) -> Tuple[Optional[str], Optional[str]]:
    """(licence text for normalise(), the text as TDC wrote it)."""
    text = field(section, "Dataset License").strip().rstrip(".").strip()
    if not text:
        return None, None
    if text.lower().startswith("not specified"):
        return NOT_SPECIFIED, text
    return text, text


def parse_page(html: str, page: str, retrieved_at: str) -> List[Dict[str, Any]]:
    """Records for the dataset sections (<h3 id=...>) of one TDC task page."""
    task = page.rstrip("/").rsplit("/", 1)[-1]
    url = f"{SITE}/{page.strip('/')}/"
    out: List[Dict[str, Any]] = []
    parts = re.split(r'(?=<h3 id="[^"]+">)', html)
    for section in parts:
        head = re.match(r'<h3 id="([^"]+)">(.*?)</h3>', section, flags=re.S)
        if not head:
            continue
        anchor, title = head.group(1), strip_tags(head.group(2))
        description = field(section, "Dataset Description")
        licence_text, licence_as_written = licence_of(section)
        if not title or not description or licence_text is None:
            continue  # a heading that is not a dataset
        loader = re.search(r"name</span>\s*<span class=\"o\">=</span>\s*<span class=\"s\">'([^']+)'", section)
        native = re.sub(r"\s+", "_", (loader.group(1) if loader else anchor).strip())
        stats = field(section, "Dataset Statistics")
        task_line = field(section, "Task Description")
        doi = schema.doi_of(section)
        domains = PAGE_DOMAINS.get(task) or tagging.domains_for([title, description])
        out.append(
            schema.make_record(
                id="tdc:" + native,
                name=f"{title} (TDC {native})" if loader else title,
                source=SOURCE,
                url=f"{url}#{anchor}",
                domains=domains,
                modality=tagging.modality_for([title, description, task_line, "smiles" if "SMILES" in section else ""]),
                description=common.safe_description(common.clean_text(description + (" Task: " + task_line if task_line else ""), 380), title),
                size=common.clean_text(stats, 120) or None,
                format="tabular, loaded with the PyTDC package (files on Harvard Dataverse)",
                licence_raw=licence_text,
                licence_source=f"TDC documentation, line 'Dataset License: {licence_as_written}'",
                citation=("doi:" + doi) if doi else None,
                retrieved_at=retrieved_at,
                how_retrieved="GET " + url + " (TDC documentation page)",
                fetcher="fetch_tdc.py",
                level="dataset",
            )
        )
    return out


def task_pages() -> List[str]:
    try:
        html = common.fetch(OVERVIEW).text()
    except Exception as err:
        common.log(f"{SOURCE}: overview not readable ({err}); using the built-in page list")
        return KNOWN_PAGES
    found = sorted(set(re.findall(r'href="/((?:single_pred|multi_pred|generation)_tasks/[a-z_0-9-]+)/?"', html)))
    pages = [p for p in found if not p.endswith("/overview")]
    return sorted(set(pages) | set(KNOWN_PAGES))


def main() -> int:
    records: Dict[str, Dict[str, Any]] = {}
    for page in task_pages():
        url = f"{SITE}/{page}/"
        try:
            got = common.fetch(url)
        except Exception as err:
            common.log(f"{SOURCE}: {url}: {err}")
            continue
        for record in parse_page(got.text(), page, got.fetched_at):
            if schema.allowed(record):
                records.setdefault(record["id"], record)
    common.write_records(SOURCE, list(records.values()), drops=schema.BOUNDARY_DROPS)
    return 0


if __name__ == "__main__":
    sys.exit(main())
