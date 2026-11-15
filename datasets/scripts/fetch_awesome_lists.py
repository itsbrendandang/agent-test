#!/usr/bin/env python3
"""Datasets named in community "awesome" lists on GitHub, with licences read from official APIs.

A list gives names and links, not licences. So each link is resolved where an official API
states the licence, and skipped otherwise:

  zenodo.org/records/<n>, figshare.com/articles/.../<n>, doi.org/<doi>
        -> GET https://api.datacite.org/dois/<doi>          (rightsList)
  github.com/<owner>/<repo>
        -> GET https://api.github.com/repos/<owner>/<repo>  (license.spdx_id; at most 60 calls per
           hour without a token, so at most GITHUB_BUDGET repositories per run)
  huggingface.co/datasets/<owner>/<name>
        -> GET https://huggingface.co/api/datasets/<owner>/<name>

Lists read: see LISTS. The README files come from raw.githubusercontent.com.
Output: /tmp/dataset-scout/records/awesome-lists.jsonl
"""

from __future__ import annotations

import re
import sys
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple

import common
import fetch_datacite
import fetch_huggingface
import schema
import tagging

SOURCE_FILE = "awesome-lists"
# (repository, branch, section headings to skip)
LISTS: List[Tuple[str, str, Tuple[str, ...]]] = [
    ("kjappelbaum/awesome-chemistry-datasets", "main", ("Contents", "Reference resources and tools", "Related lists", "Contributing")),
]
GITHUB_BUDGET = 45
ITEM = re.compile(r"^\s*[-*]\s+\[([^\]]{2,120})\]\((https?://[^)\s]+)\)\s*[:\u2013\u2014-]?\s*(.*)$")
GITHUB_NOTE = (
    "The licence is the repository's licence as GitHub reports it. It may cover the code and not "
    "the data: read the repository before use."
)


def parse_list(markdown: str, skip: Tuple[str, ...]) -> List[Dict[str, str]]:
    """List items as {name, url, text, section}. Items under a skipped heading are left out."""
    out: List[Dict[str, str]] = []
    section = ""
    for line in markdown.splitlines():
        heading = re.match(r"^#{2,4}\s+(.+?)\s*$", line)
        if heading:
            section = heading.group(1)
            continue
        if any(section.lower().startswith(s.lower()) for s in skip):
            continue
        item = ITEM.match(line)
        if item:
            out.append({"name": item.group(1).strip(), "url": item.group(2), "text": item.group(3).strip(), "section": section})
    return out


def classify(url: str) -> Tuple[str, str]:
    """('doi' | 'github' | 'huggingface' | 'other', key) for a link."""
    parts = urllib.parse.urlsplit(url)
    host = parts.netloc.lower().replace("www.", "")
    path = parts.path
    if host == "zenodo.org":
        match = re.match(r"^/records?/(\d+)", path)
        return ("doi", "10.5281/zenodo." + match.group(1)) if match else ("other", url)
    if host in ("doi.org", "dx.doi.org"):
        return "doi", urllib.parse.unquote(path.lstrip("/")).lower()
    if host == "figshare.com":
        match = re.match(r"^/articles/(?:[a-z_]+/)?[^/]+/(\d+)", path)
        return ("doi", "10.6084/m9.figshare." + match.group(1)) if match else ("other", url)
    if host == "github.com":
        match = re.match(r"^/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/?$", path)
        return ("github", f"{match.group(1)}/{match.group(2)}") if match else ("other", url)
    if host == "huggingface.co":
        match = re.match(r"^/datasets/([^/]+/[^/]+)/?$", path)
        return ("huggingface", match.group(1)) if match else ("other", url)
    return "other", url


def github_record(item: Dict[str, str], repo: Dict[str, Any], retrieved_at: str, how: str) -> Optional[Dict[str, Any]]:
    full_name = repo.get("full_name") or ""
    if not full_name or repo.get("private") or repo.get("archived") is None:
        return None
    # The list sometimes links a dataset to a larger code repository. Then the repository's
    # licence says nothing about the dataset, so the link is skipped.
    wanted = re.sub(r"[^a-z0-9]+", "", item["name"].lower())
    about = re.sub(r"[^a-z0-9]+", "", (full_name.split("/", 1)[1] + " " + (repo.get("description") or "")).lower())
    if not wanted or (wanted not in about and re.sub(r"dataset$", "", wanted) not in about):
        return None
    licence = (repo.get("license") or {}).get("spdx_id")
    if licence in (None, "NOASSERTION"):
        licence = None
    description = common.clean_text(repo.get("description") or item["text"], 300) or item["name"]
    topics = [str(t) for t in repo.get("topics") or []]
    texts = [item["name"], description, item["text"][:300], ", ".join(topics), item["section"]]
    return schema.make_record(
        id="github:" + full_name,
        name=item["name"],
        source="github",
        url="https://github.com/" + full_name,
        landing_api="https://api.github.com/repos/" + full_name,
        domains=tagging.domains_for(texts, fallback=("chemistry",)),
        modality=tagging.modality_for(texts),
        description=description,
        size=common.human_size(int(repo.get("size") or 0) * 1000),
        licence_raw=licence,
        licence_source="GitHub API, field license.spdx_id" if licence else None,
        last_updated=(repo.get("pushed_at") or "")[:10] or None,
        retrieved_at=retrieved_at,
        how_retrieved=how,
        fetcher="fetch_awesome_lists.py",
        signals={"stars": int(repo.get("stargazers_count") or 0)},
        notes=GITHUB_NOTE,
    )


def main() -> int:
    records: Dict[str, Dict[str, Any]] = {}
    counts = {"items": 0, "doi": 0, "github": 0, "huggingface": 0, "other": 0, "resolved": 0}
    github_calls = 0
    for repository, branch, skip in LISTS:
        list_url = f"https://raw.githubusercontent.com/{repository}/{branch}/README.md"
        how_list = f"list {list_url}"
        items = parse_list(common.fetch(list_url).text(), skip)
        for item in items:
            counts["items"] += 1
            kind, key = classify(item["url"])
            counts[kind] += 1
            record: Optional[Dict[str, Any]] = None
            try:
                if kind == "doi":
                    data, got = common.get_json(fetch_datacite.API + urllib.parse.quote(key, safe="/"), ok_statuses=(200,))
                    record = fetch_datacite.to_record({"doi": key, "expect": "", "name": item["name"]}, data.get("data") or {}, got.fetched_at)
                    if record:
                        record["fetcher"] = "fetch_awesome_lists.py"
                        record["how_retrieved"] = f"{how_list}; GET {fetch_datacite.API}{key}"
                elif kind == "github" and github_calls < GITHUB_BUDGET:
                    github_calls += 1
                    data, got = common.get_json("https://api.github.com/repos/" + key, headers={"Accept": "application/vnd.github+json"}, ok_statuses=(200,))
                    record = github_record(item, data, got.fetched_at, f"{how_list}; GET https://api.github.com/repos/{key}")
                elif kind == "huggingface":
                    data, got = common.get_json("https://huggingface.co/api/datasets/" + key, ok_statuses=(200,))
                    if data.get("gated") is False and not data.get("private") and not data.get("disabled"):
                        loose = dict(data, downloads=max(int(data.get("downloads") or 0), fetch_huggingface.MIN_DOWNLOADS_NO_LICENCE))
                        record = fetch_huggingface.to_record(loose, got.fetched_at, f"{how_list}; GET https://huggingface.co/api/datasets/{key}")
                        if record:
                            record["fetcher"] = "fetch_awesome_lists.py"
                            record["signals"]["downloads_30d"] = int(data.get("downloads") or 0)
            except common.HttpError as err:
                common.log(f"awesome: {item['name'][:40]}: {kind} {key}: HTTP {err.status}")
                continue
            except common.RobotsDisallowed:
                continue
            if record and schema.allowed(record):
                counts["resolved"] += 1
                records.setdefault(record["id"], record)
    common.log(f"awesome: {counts}; GitHub calls {github_calls}")
    common.write_records(SOURCE_FILE, list(records.values()), drops=schema.BOUNDARY_DROPS)
    return 0


if __name__ == "__main__":
    sys.exit(main())
