#!/usr/bin/env python3
"""Primary databases, written by hand and checked against the provider's own pages.

The list is scripts/seeds/registry.json. A seed states facts in our words (name, what it holds,
formats) and three claims that this script checks on every run:

  url       the landing page must answer (HTTP 200) when robots.txt lets us read it;
  licence   a claim holds only if a licence page of the provider (licence.evidence) matches the
            claim's pattern. If no page can be read or none matches, the claim may fall back to
            the licence that Bioregistry lists (licence.bioregistry). Otherwise the record gets
            licence "unknown". A licence is never written from memory;
  citation  a DOI is kept only if Crossref knows it and its title holds citation.title_has.

A claim of kind "varies" (a hub where each record has its own licence) needs no evidence.
Output: /tmp/dataset-scout/records/registry.jsonl and a report on stderr.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.parse
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import common
import licences
import schema

SOURCE_FILE = "registry"
SEEDS = Path(__file__).with_name("seeds") / "registry.json"
BIOREGISTRY = "https://raw.githubusercontent.com/biopragmatics/bioregistry/main/exports/registry/registry.json"
CROSSREF = "https://api.crossref.org/works/"

_bioregistry: Optional[Dict[str, Any]] = None


def page_text(url: str) -> Tuple[Optional[str], str, Optional[str]]:
    """(plain text of the page or None, why not, time fetched)."""
    try:
        got = common.fetch(url)
    except common.RobotsDisallowed:
        return None, "robots.txt disallows it", None
    except common.HttpError as err:
        return None, f"HTTP {err.status}", None
    except Exception as err:
        return None, type(err).__name__, None
    return common.clean_text(got.text(), 10 ** 7), "", got.fetched_at


def check_url(url: str) -> Tuple[str, Optional[str]]:
    """('ok' | 'not checked: <why>' | 'failed: <why>', time fetched)."""
    try:
        got = common.fetch(url, ok_statuses=(200,))
    except common.RobotsDisallowed:
        return "not checked: robots.txt disallows it", common.cached_at(url)
    except common.HttpError as err:
        return f"failed: HTTP {err.status}", None
    except Exception as err:
        return f"failed: {type(err).__name__}", None
    return "ok", got.fetched_at


def bioregistry_licence(prefix: str) -> Tuple[Optional[str], Optional[str]]:
    global _bioregistry
    if _bioregistry is None:
        try:
            _bioregistry, _ = common.get_json(BIOREGISTRY)
        except Exception as err:
            common.log(f"registry: Bioregistry not readable: {err}")
            _bioregistry = {}
    entry = (_bioregistry or {}).get(prefix) or {}
    return entry.get("license"), entry.get("homepage")


def resolve_licence(seed: Dict[str, Any]) -> Dict[str, Any]:
    """The licence fields for a seed, with the evidence that supports them."""
    spec = seed.get("licence") or {}
    tried: List[str] = []
    if spec.get("kind") == "varies":
        return {"raw": spec["claim"], "source": "Each record has its own licence; see the record.", "verified": True, "tried": tried}
    claims = spec.get("claims") or ([{"claim": spec["claim"], "pattern": spec.get("pattern")}] if spec.get("claim") else [])
    for url in spec.get("evidence") or []:
        text, why, _ = page_text(url)
        if text is None:
            tried.append(f"{url}: {why}")
            continue
        for claim in claims:
            patterns = claim.get("patterns") or [claim.get("pattern")]
            if all(p and re.search(p, text, re.I) for p in patterns):
                return {
                    "raw": claim["claim"],
                    "source": f"{url} matches /{'/ and /'.join(patterns)}/",
                    "verified": True,
                    "commercial_use": claim.get("commercial_use", spec.get("commercial_use")),
                    "share_alike": claim.get("share_alike", spec.get("share_alike")),
                    "tried": tried,
                }
        tried.append(f"{url}: read, no pattern matched")
    prefix = spec.get("bioregistry")
    if prefix:
        listed, _ = bioregistry_licence(prefix)
        if listed and licences.normalise(listed).spdx:
            return {
                "raw": listed,
                "source": f"Bioregistry entry '{prefix}' (the provider's own licence page was not read: "
                + ("; ".join(tried) or "no evidence page set") + ")",
                "verified": True,
                "tried": tried,
            }
        tried.append(f"Bioregistry '{prefix}': no SPDX licence listed")
    return {"raw": None, "source": None, "verified": False, "tried": tried}


def resolve_citation(seed: Dict[str, Any]) -> Tuple[Optional[str], str]:
    spec = seed.get("citation") or {}
    doi = (spec.get("doi") or "").strip().lower()
    if not doi:
        return None, "no DOI in the seed"
    try:
        data, _ = common.get_json(CROSSREF + urllib.parse.quote(doi, safe="/"), ok_statuses=(200,))
    except Exception as err:
        return None, f"Crossref: {err}"
    titles = (data.get("message") or {}).get("title") or []
    wanted = (spec.get("title_has") or "").lower()
    if wanted and any(wanted in t.lower() for t in titles):
        return "doi:" + doi, "ok"
    return None, f"Crossref title {titles[:1]} does not hold {wanted!r}"


def same_as(seed: Dict[str, Any]) -> List[str]:
    """Ids of records in other sources that describe the same resource (used to drop duplicates)."""
    out = list(seed.get("same_as") or [])
    prefix = (seed.get("licence") or {}).get("bioregistry")
    if prefix:
        out.append("bioregistry:" + prefix.split(".", 1)[0])
    return out


def to_record(seed: Dict[str, Any], run_stamp: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    url_state, url_time = check_url(seed["url"])
    licence = resolve_licence(seed)
    citation, citation_state = resolve_citation(seed)
    notes: List[str] = []
    if seed.get("notes"):
        notes.append(seed["notes"])
    if not licence["verified"]:
        claimed = (seed.get("licence") or {}).get("claim") or (seed.get("licence") or {}).get("unverified")
        notes.append(
            "Licence not re-read at the provider (" + ("; ".join(licence["tried"]) or "no licence page known") + ")."
            + (f" Unverified pointer: reported as {claimed}." if claimed else "")
        )
    if url_state != "ok":
        notes.append("Landing page " + url_state + ".")
    record = schema.make_record(
        id="db:" + seed["id"],
        name=seed["name"],
        source=seed.get("source") or seed["id"],
        url=seed["url"],
        landing_api=seed.get("api"),
        domains=seed["domains"],
        modality=seed["modality"],
        description=seed["description"],
        size=seed.get("size"),
        format=seed.get("format"),
        access=seed.get("access", "open"),
        licence_raw=licence["raw"],
        licence_source=licence["source"],
        commercial_use=licence.get("commercial_use"),
        share_alike=licence.get("share_alike"),
        citation=citation,
        last_updated=seed.get("last_updated"),
        retrieved_at=url_time or run_stamp,
        how_retrieved="seed scripts/seeds/registry.json, checked by fetch_registry.py (landing page, licence page, Crossref)",
        fetcher="fetch_registry.py",
        level=seed.get("level", "repository"),
        notes=" ".join(notes) or None,
        same_as=same_as(seed),
    )
    report = {"id": record["id"], "url": url_state, "licence": record["licence"], "licence_ok": licence["verified"],
              "tried": licence["tried"], "citation": citation_state}
    return record, report


def run_stamp() -> str:
    """A fixed time for records whose landing page could not be read: the seed file's own time."""
    stamp = SEEDS.stat().st_mtime
    from datetime import datetime, timezone

    return datetime.fromtimestamp(stamp, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> int:
    seeds = json.loads(SEEDS.read_text(encoding="utf-8"))
    only = set(sys.argv[1:])
    stamp = run_stamp()
    records: List[Dict[str, Any]] = []
    bad = 0
    for seed in seeds:
        if only and seed["id"] not in only:
            continue
        record, report = to_record(seed, stamp)
        problems = schema.validate(record)
        flag = "ok  " if report["licence_ok"] and report["url"] == "ok" else "WARN"
        common.log(f"{flag} {report['id']:<28} url={report['url']:<40.40} licence={report['licence'][:40]:<40} doi={report['citation'][:40]}")
        for line in report["tried"]:
            common.log(f"       evidence: {line}")
        if problems:
            bad += 1
            common.log(f"       INVALID: {problems}")
            continue
        if report["url"].startswith("failed"):
            common.log("       DROPPED: the landing page does not answer, so the entry is not listed")
            continue
        records.append(record)
    if not only:
        common.write_records(SOURCE_FILE, records, drops=schema.BOUNDARY_DROPS)
    common.log(f"registry: {len(records)} records, {bad} invalid")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
