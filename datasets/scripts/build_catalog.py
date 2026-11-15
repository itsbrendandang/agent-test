#!/usr/bin/env python3
"""Validate the fetchers' records, drop duplicates and write datasets/catalog.jsonl.

  python3 build_catalog.py            merge /tmp/dataset-scout/records/*.jsonl into catalog.jsonl
  python3 build_catalog.py --check    only validate the catalog.jsonl that is in the repository
  python3 build_catalog.py --stats    print the count tables (Markdown) for the catalogue

A fetcher that was not re-run keeps its old records: the build carries them over from the
existing catalog.jsonl. So one source can be refreshed without fetching all the others.
The output is sorted by id and is the same for the same inputs. No network is used here.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import common
import licences
import schema

HERE = Path(__file__).resolve().parent
CATALOG = HERE.parent / "catalog.jsonl"
README = HERE.parent / "README.md"
MAX_BYTES = 4_500_000  # the repository's CI refuses a file over 5 MB

# When two records describe the same thing, the record from the fetcher listed first wins.
PRIORITY = [
    "fetch_registry.py", "fetch_tdc.py", "fetch_gdc.py", "fetch_openfda.py", "fetch_datacite.py",
    "fetch_awesome_lists.py", "fetch_aws_open_data.py", "fetch_obofoundry.py", "fetch_bioregistry.py", "fetch_openml.py",
    "fetch_huggingface.py", "fetch_kaggle.py",
]
DOI_KEYED_SOURCES = ("zenodo", "figshare", "dryad", "dataverse", "mendeley-data", "datacite")

# The same patterns as the repository's CI guard: a record that trips one is dropped.
KEY_LIKE = [
    re.compile(p)
    for p in (
        r"(^|[^A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{20,}",
        r"(^|[^A-Za-z0-9])sk-or-v1-[A-Za-z0-9]{32,}",
        r"(^|[^A-Za-z0-9])sk-(proj|svcacct|admin)-[A-Za-z0-9_-]{20,}",
        r"(^|[^A-Za-z0-9-])sk-[A-Za-z0-9]{32,}",
        r"(^|[^A-Za-z0-9])hf_[A-Za-z0-9]{30,}",
        r"(^|[^A-Za-z0-9])(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})",
        r"(^|[^A-Z0-9])(AKIA|ASIA)[0-9A-Z]{16}([^A-Z0-9]|$)",
        r"(^|[^A-Za-z0-9])AIza[0-9A-Za-z_-]{35}",
        r"(^|[^A-Za-z0-9])xox[abprs]-[A-Za-z0-9-]{10,}",
        r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
        r"[A-Z0-9_]*(API_?KEY|TOKEN|SECRET|PASSWORD)[\"']?\s*[:=]\s*[\"']?[A-Za-z0-9_+/-]{24,}",
    )
]


def rank(record: Dict[str, Any]) -> int:
    fetcher = record.get("fetcher", "")
    return PRIORITY.index(fetcher) if fetcher in PRIORITY else len(PRIORITY)


def url_key(url: str) -> str:
    """A URL without scheme, 'www.' and trailing slash. The fragment stays: it tells entries apart."""
    parts = urllib.parse.urlsplit(url.strip())
    host = parts.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    path = parts.path.rstrip("/")
    key = host + path
    if parts.query:
        key += "?" + parts.query
    if parts.fragment:
        key += "#" + parts.fragment
    return key.lower() if host in ("doi.org", "dx.doi.org") else key


def dedup_keys(record: Dict[str, Any]) -> List[str]:
    keys = ["id:" + record["id"], "url:" + url_key(record["url"])]
    doi = schema.doi_of(record.get("citation"))
    if doi and (record.get("source") in DOI_KEYED_SOURCES or doi.startswith("10.57967/")):
        keys.append("doi:" + re.sub(r"\.v\d+$", "", doi))
    return keys


def same_key(record_id: str) -> str:
    """Bioregistry has several namespaces per database ("iuphar.ligand", "iuphar.family"): they
    count as one resource, named by the part before the first dot."""
    if record_id.startswith("bioregistry:"):
        return "bioregistry:" + record_id.split(":", 1)[1].split(".", 1)[0]
    return record_id


def dedup(records: Iterable[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Tuple[str, str, str]]]:
    """Keep one record per id, per URL and per dataset DOI. Returns (kept, dropped).

    dropped holds (dropped id, kept id, why). A record that names others in same_as replaces them.
    """
    ordered = sorted(records, key=lambda r: (rank(r), r["id"]))
    claimed: Dict[str, str] = {}
    for record in ordered:
        for other in record.get("same_as") or []:
            claimed.setdefault(same_key(other), record["id"])
    seen: Dict[str, str] = {}
    kept: List[Dict[str, Any]] = []
    dropped: List[Tuple[str, str, str]] = []
    for record in ordered:
        owner = claimed.get(same_key(record["id"]))
        if owner and owner != record["id"]:
            dropped.append((record["id"], owner, "same_as"))
            continue
        clash: Optional[Tuple[str, str]] = None
        for key in dedup_keys(record):
            if key in seen:
                clash = (seen[key], key.split(":", 1)[0])
                break
        if clash:
            dropped.append((record["id"], clash[0], clash[1]))
            continue
        for key in dedup_keys(record):
            seen[key] = record["id"]
        kept.append(record)
    kept.sort(key=lambda r: r["id"])
    return kept, dropped


def key_like(record: Dict[str, Any]) -> bool:
    line = json.dumps(record, ensure_ascii=False)
    return any(pattern.search(line) for pattern in KEY_LIKE)


def check_records(records: List[Dict[str, Any]]) -> List[str]:
    """Problems of a finished catalogue: invalid records, duplicate keys, key-like strings."""
    problems: List[str] = []
    seen: Dict[str, str] = {}
    for record in records:
        for problem in schema.validate(record):
            problems.append(f"{record.get('id')}: {problem}")
        if key_like(record):
            problems.append(f"{record.get('id')}: holds a string that looks like an API key")
        if "id" in record and "url" in record:
            for key in dedup_keys(record):
                if key in seen:
                    problems.append(f"{record['id']}: duplicate of {seen[key]} ({key.split(':', 1)[0]})")
                seen[key] = record["id"]
    if [r.get("id") for r in records] != sorted(r.get("id") for r in records):
        problems.append("records are not sorted by id")
    return problems


def dump(records: List[Dict[str, Any]]) -> str:
    return "".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in records)


# ---------------------------------------------------------------------------------------------
# Counts
# ---------------------------------------------------------------------------------------------


def count_by(records: List[Dict[str, Any]], key: str) -> List[Tuple[str, int]]:
    counts: Dict[str, int] = {}
    for record in records:
        values = record[key] if isinstance(record[key], list) else [record[key]]
        for value in values:
            counts[str(value)] = counts.get(str(value), 0) + 1
    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))


def table(rows: List[Tuple[Any, ...]], header: Tuple[str, ...]) -> str:
    lines = ["| " + " | ".join(header) + " |", "|" + "|".join("---" for _ in header) + "|"]
    lines += ["| " + " | ".join(str(c) for c in row) + " |" for row in rows]
    return "\n".join(lines)


def stats_markdown(records: List[Dict[str, Any]]) -> str:
    total = len(records)
    spdx = sum(1 for r in records if all(p.lower() in licences.SPDX for p in r["licence"].split(" AND ")))
    unknown = sum(1 for r in records if r["licence"] == licences.UNKNOWN)
    commercial = dict(count_by(records, "commercial_use"))
    share = sum(1 for r in records if r["share_alike"])
    safe = sum(1 for r in records if r["commercial_use"] == "yes" and not r["share_alike"])
    out = [
        f"Total entries: **{total}**",
        "",
        table(
            [
                ("Commercial use allowed by the licence (`commercial_use: yes`)", commercial.get("yes", 0)),
                ("... of these, with no share-alike condition", safe),
                ("Commercial use not allowed (`no`)", commercial.get("no", 0)),
                ("Not clear from the licence or no licence stated (`unclear`)", commercial.get("unclear", 0)),
                ("Share-alike (`share_alike: true`)", share),
                ("Licence is an SPDX identifier", spdx),
                ("Licence is the provider's own terms (kept as a name)", total - spdx - unknown),
                ("Licence `unknown`", unknown),
                ("Access `open`", sum(1 for r in records if r["access"] == "open")),
                ("Access `registration` (free account needed)", sum(1 for r in records if r["access"] == "registration")),
            ],
            ("What", "Entries"),
        ),
        "",
        "By source:",
        "",
        table(count_by(records, "source")[:25] + [("(other sources, one or two entries each)", sum(n for _, n in count_by(records, "source")[25:]))], ("Source", "Entries")),
        "",
        "By level:",
        "",
        table(count_by(records, "level"), ("Level", "Entries")),
        "",
        "By domain (one entry can have several domains):",
        "",
        table(count_by(records, "domains"), ("Domain", "Entries")),
        "",
        "By licence (the 25 most frequent):",
        "",
        table(count_by(records, "licence")[:25], ("Licence", "Entries")),
    ]
    return "\n".join(out) + "\n"


def update_readme(markdown: str) -> bool:
    """Replace the block between the stats markers in README.md. True when the file changed."""
    if not README.exists():
        return False
    text = README.read_text(encoding="utf-8")
    begin, end = "<!-- stats:begin -->", "<!-- stats:end -->"
    if begin not in text or end not in text:
        return False
    new = text[: text.index(begin) + len(begin)] + "\n" + markdown + text[text.index(end):]
    if new != text:
        README.write_text(new, encoding="utf-8")
        return True
    return False


# ---------------------------------------------------------------------------------------------


def load_fresh(folder: Path) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    for path in sorted(folder.glob("*.jsonl")):
        records.extend(common.read_jsonl(path))
    return records


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--records", default=str(common.RECORDS), help="folder with the fetchers' *.jsonl files")
    parser.add_argument("--out", default=str(CATALOG))
    parser.add_argument("--check", action="store_true", help="validate the existing catalogue and stop")
    parser.add_argument("--stats", action="store_true", help="print the count tables and stop")
    parser.add_argument("--no-carry-over", action="store_true", help="do not keep records of fetchers that were not re-run")
    args = parser.parse_args()
    out_path = Path(args.out)

    if args.check or args.stats:
        records = common.read_jsonl(out_path)
        if args.stats:
            print(stats_markdown(records), end="")
            return 0
        problems = check_records(records)
        size = out_path.stat().st_size
        if size > MAX_BYTES:
            problems.append(f"catalog.jsonl is {size} bytes; the limit is {MAX_BYTES}")
        for problem in problems[:50]:
            print("PROBLEM", problem)
        print(f"{len(records)} records, {len(problems)} problems")
        return 1 if problems else 0

    fresh = load_fresh(Path(args.records))
    fresh_fetchers = {r.get("fetcher") for r in fresh}
    carried: List[Dict[str, Any]] = []
    if out_path.exists() and not args.no_carry_over:
        carried = [r for r in common.read_jsonl(out_path) if r.get("fetcher") not in fresh_fetchers]
    common.log(f"build: {len(fresh)} fresh records from {len(fresh_fetchers)} fetchers; {len(carried)} carried over")

    usable: List[Dict[str, Any]] = []
    reasons: Dict[str, int] = {}
    invalid = 0
    for record in fresh + carried:
        reason = schema.boundary_reason(record)
        if reason:
            reasons[reason.split(":", 1)[0]] = reasons.get(reason.split(":", 1)[0], 0) + 1
            common.log(f"build: boundary rule refused {record.get('id')}: {reason}")
            continue
        if key_like(record):
            reasons["key-like string"] = reasons.get("key-like string", 0) + 1
            continue
        problems = schema.validate(record)
        if problems:
            invalid += 1
            common.log(f"build: INVALID {record.get('id')}: {problems[:3]}")
            continue
        usable.append(record)
    for path in sorted(Path(args.records).glob("*.drops.json")):  # refused earlier, inside the fetchers
        for rule, count in json.loads(path.read_text()).items():
            reasons[rule] = reasons.get(rule, 0) + count
    kept, dropped = dedup(usable)
    for dropped_id, kept_id, why in dropped:
        common.log(f"build: duplicate {dropped_id} -> kept {kept_id} ({why})")
    text = dump(kept)
    if len(text.encode("utf-8")) > MAX_BYTES:
        common.log(f"build: output would be {len(text.encode('utf-8'))} bytes, over the limit of {MAX_BYTES}")
        return 1
    out_path.write_text(text, encoding="utf-8")
    common.log(
        f"build: wrote {len(kept)} records to {out_path} ({len(text.encode('utf-8'))} bytes); "
        f"dropped {len(dropped)} duplicates, {sum(reasons.values())} by boundary rules {reasons}, {invalid} invalid"
    )
    if update_readme(stats_markdown(kept)):
        common.log("build: README.md count tables updated")
    return 1 if invalid else 0


if __name__ == "__main__":
    sys.exit(main())
