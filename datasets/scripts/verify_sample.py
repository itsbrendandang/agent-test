#!/usr/bin/env python3
"""Re-check a random sample of the catalogue against the live sources.

  python3 verify_sample.py --n 48 --seed 20261114

For each sampled record the script
  1. fetches the landing page (record.url) again, through the polite client (robots.txt, rate
     limit, redirects checked hop by hop), and notes whether it answers;
  2. reads the licence again from the source, by the first route that applies:
       a. the evidence page and pattern stored in licence_source ("<url> matches /<pattern>/");
       b. the record's API (Hugging Face, DataCite, GitHub, Bioregistry, Kaggle's list endpoint);
       c. for a TDC dataset, the documentation section, parsed again;
       d. a licence statement on the landing page (licences.detect), or the record's own
          licence words on that page.

Verdicts per record
  url:      ok | blocked (robots.txt or a bot challenge: not an error of the record) | error
  licence:  match | mismatch | missed (record says unknown, the source states one)
            | not-checkable (no licence statement could be read anywhere)
The error rate counts url=error and licence=mismatch. The report is written to
/tmp/dataset-scout/verify/report.json and printed as a table. Nothing is written to the repository.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
import urllib.parse
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import common
import licences

CATALOG = Path(__file__).resolve().parent.parent / "catalog.jsonl"
OUT = common.ROOT / "verify"


def read_page(url: str) -> Tuple[str, Optional[str], str]:
    """(state, text, detail). state is ok, blocked or error."""
    try:
        got = common.fetch(url, ok_statuses=(200, 202, 401, 403, 404, 410, 429))
    except common.RobotsDisallowed as err:
        return "blocked", None, f"robots.txt disallows {err.url[:80]}"
    except common.HttpError as err:
        return "error", None, f"HTTP {err.status}"
    except Exception as err:
        return "error", None, type(err).__name__
    if got.status in (202, 401, 403, 429):
        return "blocked", None, f"HTTP {got.status} (the site refuses scripts)"
    if got.status != 200:
        return "error", None, f"HTTP {got.status}"
    return "ok", got.text(), got.headers.get("x-final-url", url)


def parts(licence_id: str) -> Set[str]:
    return set(licence_id.split(" AND "))


def is_spdx(licence_id: str) -> bool:
    return all(part.lower() in licences.SPDX for part in parts(licence_id))


def compare(record_licence: str, stated: Set[str]) -> str:
    """match, mismatch, missed or not-checkable, from the licences a page or an API states."""
    if not stated:
        return "not-checkable"
    if record_licence in stated:
        return "match"
    if record_licence == licences.UNKNOWN:
        return "missed"
    if not is_spdx(record_licence):
        return "not-checkable"
    wanted = {licences.family(part) for part in parts(record_licence)}
    found = {licences.family(item) for item in stated}
    return "match" if wanted <= found else "mismatch"


def api_licences(record: Dict[str, Any]) -> Tuple[Optional[Set[str]], str]:
    """Licences that the record's own API states now. None when there is no API we can ask."""
    api = record.get("landing_api") or ""
    try:
        if api.startswith("https://huggingface.co/api/datasets/"):
            data, _ = common.get_json(api)
            if data.get("gated") is not False or data.get("private") or data.get("disabled"):
                return {"__gated__"}, "Hugging Face API: the dataset is now gated, private or disabled"
            tags = [t.split(":", 1)[1] for t in data.get("tags") or [] if t.startswith("license:")]
            return {licences.normalise(tags).id} - {licences.UNKNOWN}, "Hugging Face API, licence tag"
        if api.startswith("https://api.datacite.org/dois/"):
            data, _ = common.get_json(api)
            rights = []
            for right in ((data.get("data") or {}).get("attributes") or {}).get("rightsList") or []:
                value = right.get("rightsIdentifier") or right.get("rightsUri") or right.get("rights")
                if value:
                    rights.append(str(value))
            return {licences.normalise(rights).id} - {licences.UNKNOWN}, "DataCite API, rightsList"
        if api.startswith("https://api.github.com/repos/"):
            data, _ = common.get_json(api, headers={"Accept": "application/vnd.github+json"})
            spdx_id = (data.get("license") or {}).get("spdx_id")
            return ({spdx_id} if spdx_id and spdx_id != "NOASSERTION" else set()), "GitHub API, license.spdx_id"
        if api.startswith("https://bioregistry.io/api/registry/"):
            data, _ = common.get_json(api)
            return {licences.normalise(data.get("license")).id} - {licences.UNKNOWN}, "Bioregistry API, field license"
        if api.startswith("https://www.kaggle.com/api/v1/datasets/list"):
            data, _ = common.get_json(api)
            ref = record["id"].split(":", 1)[1]
            mine = [item for item in data if item.get("ref") == ref]
            if not mine:
                return None, "Kaggle list endpoint: the dataset is not in the first page for its title"
            return {licences.normalise(mine[0].get("licenseName")).id} - {licences.UNKNOWN}, "Kaggle list endpoint, licenseName"
    except common.RobotsDisallowed:
        return None, "API disallowed by robots.txt"
    except Exception as err:
        return None, f"API not readable: {err}"
    return None, "no API to ask"


def evidence_recheck(record: Dict[str, Any]) -> Optional[str]:
    """For a registry record: read the evidence page again and apply the stored pattern."""
    source = record.get("licence_source") or ""
    match = re.match(r"^(https?://\S+) matches /(.+)/$", source)
    if not match:
        return None
    state, text, _ = read_page(match.group(1))
    if state != "ok" or text is None:
        return "not-checkable"
    plain = common.clean_text(text, 10 ** 7)
    patterns = match.group(2).split("/ and /")
    return "match" if all(re.search(p, plain, re.I) for p in patterns) else "mismatch"


def tdc_recheck(record: Dict[str, Any], page_html: str) -> Optional[str]:
    """Parse the TDC documentation page again and compare this dataset's licence."""
    import fetch_tdc

    page = urllib.parse.urlsplit(record["url"]).path.strip("/")
    again = {r["id"]: r for r in fetch_tdc.parse_page(page_html, page, record["retrieved_at"])}
    if record["id"] not in again:
        return "mismatch"
    return "match" if again[record["id"]]["licence"] == record["licence"] else "mismatch"


def words_on_page(record: Dict[str, Any], plain: str) -> bool:
    """True when the record's licence words (a provider's own terms) stand on the page."""
    low = re.sub(r"\s+", " ", plain.lower())
    for text in (record.get("licence_raw") or "", record["licence"]):
        text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
        probe = re.sub(r"\s+", " ", text.lower()).strip(" .")[:60]
        if len(probe) >= 12 and probe in low:
            return True
    return False


def check(record: Dict[str, Any]) -> Dict[str, Any]:
    state, text, detail = read_page(record["url"])
    result: Dict[str, Any] = {
        "id": record["id"], "source": record["source"], "licence": record["licence"], "url": record["url"],
        "url_state": state, "url_detail": detail, "name_on_page": None, "licence_state": "not-checkable", "licence_detail": "",
    }
    stated: Set[str] = set()
    if text:
        plain = common.clean_text(text, 10 ** 7)
        key = re.sub(r"\(.*?\)", "", record["name"]).split(":")[0].split("/")[-1].strip().lower()
        words = [w for w in re.split(r"[^a-z0-9]+", key) if len(w) > 2][:3]
        result["name_on_page"] = bool(words) and all(w in plain.lower() for w in words)
        stated = licences.detect(text)
    plain = common.clean_text(text, 10 ** 7) if text else ""
    rechecked = evidence_recheck(record)
    if rechecked:
        result["licence_state"], result["licence_detail"] = rechecked, "evidence page read again with the stored pattern"
    elif record["id"].startswith("tdc:") and text:
        result["licence_state"], result["licence_detail"] = tdc_recheck(record, text), "TDC documentation section parsed again"
    else:
        from_api, how = api_licences(record)
        if from_api is not None and "__gated__" in from_api:
            result["licence_state"], result["licence_detail"] = "mismatch", how
        elif from_api is not None:
            verdict = compare(record["licence"], from_api)
            if not from_api and record["licence"] == licences.UNKNOWN:
                verdict = "match"  # the source states no licence and the record says unknown
            elif not from_api:
                verdict = "mismatch"  # the record names a licence that the source no longer states
            result["licence_state"], result["licence_detail"] = verdict, f"{how}: {sorted(from_api) or 'none stated'}"
        else:
            verdict = compare(record["licence"], stated)
            detail = f"landing page states {sorted(stated) or 'no licence that the patterns find'}"
            if verdict in ("not-checkable", "mismatch") and plain and words_on_page(record, plain):
                verdict, detail = "match", "the record's licence words stand on the landing page"
            result["licence_state"], result["licence_detail"] = verdict, detail + (f" ({how})" if how != "no API to ask" else "")
    if result["licence_state"] == "match" and stated and is_spdx(record["licence"]):
        on_page = {licences.family(part) for part in parts(record["licence"])} <= {licences.family(s) for s in stated}
        result["licence_detail"] += "; also on the landing page" if on_page else f"; the landing page shows {sorted(stated)}"
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--n", type=int, default=48)
    parser.add_argument("--seed", type=int, default=20261114)
    args = parser.parse_args()
    records = common.read_jsonl(CATALOG)
    sample = random.Random(args.seed).sample(sorted(records, key=lambda r: r["id"]), min(args.n, len(records)))
    results: List[Dict[str, Any]] = []
    for record in sorted(sample, key=lambda r: r["id"]):
        result = check(record)
        results.append(result)
        common.log(f"{result['url_state']:<8} {result['licence_state']:<14} {result['id'][:44]:<44} {result['licence'][:22]:<22} {result['licence_detail'][:90]}")
    n = len(results)
    url_errors = [r for r in results if r["url_state"] == "error"]
    blocked = [r for r in results if r["url_state"] == "blocked"]
    mismatches = [r for r in results if r["licence_state"] == "mismatch"]
    missed = [r for r in results if r["licence_state"] == "missed"]
    unchecked = [r for r in results if r["licence_state"] == "not-checkable"]
    wrong = {r["id"] for r in url_errors} | {r["id"] for r in mismatches}
    summary = {
        "sample": n, "seed": args.seed, "catalogue_size": len(records),
        "url_ok": sum(1 for r in results if r["url_state"] == "ok"), "url_blocked": len(blocked), "url_error": len(url_errors),
        "licence_match": sum(1 for r in results if r["licence_state"] == "match"), "licence_mismatch": len(mismatches),
        "licence_missed": len(missed), "licence_not_checkable": len(unchecked),
        "records_with_an_error": len(wrong), "error_rate": round(len(wrong) / n, 4) if n else None,
        "requests_total_so_far": common.request_count(),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "report.json").write_text(json.dumps({"summary": summary, "results": results}, indent=1, ensure_ascii=False))
    print(json.dumps(summary, indent=1))
    for label, rows in (("URL errors", url_errors), ("Licence mismatches", mismatches), ("Licence missed", missed)):
        for row in rows:
            print(f"{label}: {row['id']} | {row['url']} | {row['url_detail']} | {row['licence']} | {row['licence_detail']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
