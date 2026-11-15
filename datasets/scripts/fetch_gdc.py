#!/usr/bin/env python3
"""NCI Genomic Data Commons: one record per project, counting only open-access files.

Endpoints:
  GET https://api.gdc.cancer.gov/projects            the projects (TCGA, TARGET, CPTAC, ...)
  GET https://api.gdc.cancer.gov/files?filters=...   open-access file count and size per project (facets)
  GET https://api.gdc.cancer.gov/status              the data release
A project is a consortium collection. Single cases and controlled-access files are not listed.
Output: /tmp/dataset-scout/records/gdc.jsonl
"""

from __future__ import annotations

import json
import re
import sys
import urllib.parse
from typing import Any, Dict, List, Optional

import common
import schema

SOURCE = "gdc"
API = "https://api.gdc.cancer.gov"
FIELDS = "project_id,name,program.name,primary_site,disease_type,summary.case_count,summary.file_count,released,state"
POLICY_URL = "https://gdc.cancer.gov/access-data/data-access-policies"
# The GDC states its terms in a policy page, not in a licence. We store the policy's name, and
# only when the page still carries the sentence below.
LICENCE_NAME = "NIH Genomic Data Sharing Policy; GDC open-access tier (no licence stated)"
POLICY_PATTERN = r"open and controlled data access adhere to the National Institutes of Health \(NIH\) Genomic Data Sharing Policy"


def policy_confirmed() -> bool:
    try:
        page = common.clean_text(common.fetch(POLICY_URL).text(), 10 ** 7)
    except Exception as err:
        common.log(f"{SOURCE}: policy page not readable: {err}")
        return False
    return re.search(POLICY_PATTERN, page, re.I) is not None

STRATEGY_DOMAINS = {
    "RNA-Seq": "transcriptomics", "miRNA-Seq": "transcriptomics", "scRNA-Seq": "single-cell",
    "WXS": "variation", "WGS": "genomics", "Methylation Array": "epigenomics", "ATAC-Seq": "epigenomics",
    "Genotyping Array": "variation", "Tissue Slide": "imaging", "Diagnostic Slide": "imaging",
    "Reverse Phase Protein Array": "proteomics", "Targeted Sequencing": "variation",
}


def projects_url() -> str:
    fields = FIELDS + ",summary.experimental_strategies.experimental_strategy,summary.data_categories.data_category"
    return API + "/projects?" + urllib.parse.urlencode({"size": "1000", "fields": fields, "sort": "project_id:asc"})


def open_files_url() -> str:
    filters = {"op": "in", "content": {"field": "access", "value": ["open"]}}
    query = {"filters": json.dumps(filters, separators=(",", ":")), "facets": "cases.project.project_id", "size": "0"}
    return API + "/files?" + urllib.parse.urlencode(query)


def to_record(
    project: Dict[str, Any], open_files: Dict[str, int], release: str, retrieved_at: str, policy_ok: bool = True
) -> Optional[Dict[str, Any]]:
    project_id = project.get("project_id") or ""
    if not project_id or not project.get("released") or project.get("state") != "open":
        return None
    n_open = open_files.get(project_id, 0)
    if n_open == 0:
        return None  # nothing in the open tier
    summary = project.get("summary") or {}
    strategies = [s.get("experimental_strategy", "") for s in summary.get("experimental_strategies") or []]
    categories = sorted({c.get("data_category", "") for c in summary.get("data_categories") or []} - {""})
    domains = {"cancer", "genomics"} | {STRATEGY_DOMAINS[s] for s in strategies if s in STRATEGY_DOMAINS}
    if "Clinical" in categories:
        domains.add("clinical")
    program = (project.get("program") or {}).get("name") or ""
    sites = [s for s in project.get("primary_site") or [] if s and s != "Not Reported"]
    name = project.get("name") or project_id
    description = (
        f"GDC project {project_id} ({program}): {name}. {summary.get('case_count', 0)} cases. "
        f"Open-access files: {n_open} of {summary.get('file_count', 0)}. "
        f"Data categories: {', '.join(categories) or 'not stated'}."
        + (f" Primary sites: {', '.join(sites[:4])}." if sites else "")
    )
    return schema.make_record(
        id="gdc:" + project_id,
        name=f"{project_id}: {name}",
        source=SOURCE,
        url="https://portal.gdc.cancer.gov/projects/" + project_id,
        landing_api=f"{API}/projects/{project_id}",
        domains=sorted(domains),
        modality="open tier: clinical and biospecimen tables, gene-level counts, masked somatic mutations, copy number, slides (varies by project)",
        description=common.clean_text(description, 390),
        size=f"{n_open} open-access files",
        format="TSV, MAF, TXT, SVS, BCR XML (open tier)",
        licence_raw=LICENCE_NAME if policy_ok else None,
        licence_source=f"{POLICY_URL} matches /{POLICY_PATTERN}/" if policy_ok else None,
        last_updated=None,
        retrieved_at=retrieved_at,
        how_retrieved=f"GET {API}/projects and GET {API}/files (facet on access=open); data release {release}",
        fetcher="fetch_gdc.py",
        level="collection",
        notes="Controlled-access files of this project need dbGaP approval and are not part of this entry.",
    )


def main() -> int:
    status, _ = common.get_json(API + "/status")
    release = str(status.get("data_release") or "unknown")
    projects, got = common.get_json(projects_url())
    facets, _ = common.get_json(open_files_url())
    buckets = facets["data"]["aggregations"]["cases.project.project_id"]["buckets"]
    open_files = {b["key"]: int(b["doc_count"]) for b in buckets}
    records: List[Dict[str, Any]] = []
    policy_ok = policy_confirmed()
    for project in projects["data"]["hits"]:
        record = to_record(project, open_files, release, got.fetched_at, policy_ok)
        if record and schema.allowed(record):
            records.append(record)
    common.log(f"{SOURCE}: {len(projects['data']['hits'])} projects, {len(records)} with open-access files")
    common.write_records(SOURCE, records, drops=schema.BOUNDARY_DROPS)
    return 0


if __name__ == "__main__":
    sys.exit(main())
