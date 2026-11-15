#!/usr/bin/env python3
"""Pre-fetch a biomedical literature EVIDENCE corpus to back up the agents' claims.

Our app checks claims with `literature_search` (engine/src/literature.ts), which queries
Europe PMC (PubMed + preprints) live and screens the abstracts as evidence. This script hits
the SAME source and saves the abstracts, so you have a cached evidence base you can inspect,
cite, demo offline, or reuse across runs.

For each query it saves one Markdown file with the top abstracts (title, journal, year, URL,
abstract text) -- the same fields the live tool uses. Standard library only; no API key.

Usage:
  python3 glhf/scripts/fetch_literature.py "KRAS G12C covalent inhibitor hERG"
  python3 glhf/scripts/fetch_literature.py --file claims.txt        # one query per line
  python3 glhf/scripts/fetch_literature.py "TP53 mutation prognosis" --max 8

Query tips (same as the app's guidance): 3-6 PubMed-style keywords, no sentences.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import ssl
import time
import urllib.parse
import urllib.request
from pathlib import Path

# Same endpoint the app uses (engine/src/literature.ts: LITERATURE_URL).
LITERATURE_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
OUT_ROOT = Path(__file__).resolve().parents[1] / "data" / "literature"
UA = {"User-Agent": "agent-test-literature-fetch/1.0 (hackathon evidence corpus)"}
MAX_ABSTRACT_CHARS = 3000

_SSL: ssl.SSLContext | None = None


def _ssl_ctx() -> ssl.SSLContext:
    """Verified TLS, falling back to unverified if the trust store is broken (macOS)."""
    try:
        import certifi  # type: ignore

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        pass
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(
            urllib.request.Request(LITERATURE_URL + "?query=test&format=json&pageSize=1",
                                    headers=UA),
            timeout=10, context=ctx,
        ):
            return ctx
    except Exception:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx


def _tags(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def search(query: str, max_results: int) -> list[dict]:
    """One Europe PMC search. Mirrors parseEuropePmc() in literature.ts."""
    global _SSL
    if _SSL is None:
        _SSL = _ssl_ctx()
    params = {"query": query, "resultType": "core", "format": "json",
              "pageSize": str(max_results)}
    url = f"{LITERATURE_URL}?{urllib.parse.urlencode(params)}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA),
                                timeout=20, context=_SSL) as resp:
        body = json.loads(resp.read())
    records = (body.get("resultList") or {}).get("result") or []
    items = []
    for r in records:
        source = r.get("source", "MED")
        pmid = r.get("pmid", "")
        if source == "MED" and re.fullmatch(r"\d+", pmid or ""):
            link = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
        else:
            link = f"https://europepmc.org/article/{urllib.parse.quote(source)}/{r.get('id', '')}"
        journal = (r.get("journalInfo") or {}).get("journal", {}).get("title", "")
        where = ", ".join(
            x for x in [("preprint" if source == "PPR" else journal), r.get("pubYear", "")] if x
        )
        items.append({
            "title": _tags(str(r.get("title", ""))),
            "where": where,
            "url": link,
            "is_review": any(re.search("review", t, re.I)
                             for t in (r.get("pubTypeList") or {}).get("pubType", [])),
            "abstract": _tags(str(r.get("abstractText", "")))[:MAX_ABSTRACT_CHARS],
        })
    return items


def safe_name(s: str, limit: int = 70) -> str:
    s = re.sub(r"[^\w\- ]", "", s).strip().replace(" ", "_")
    return s[:limit] or "query"


def save(query: str, items: list[dict], dest: Path) -> Path:
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / f"{safe_name(query)}.md"
    lines = [f"# Evidence for: {query}", "", f"_Source: Europe PMC. {len(items)} results._", ""]
    for i, it in enumerate(items, 1):
        tag = " (review)" if it["is_review"] else ""
        lines += [
            f"## {i}. {it['title']}{tag}",
            f"- {it['where']}",
            f"- {it['url']}",
            "",
            it["abstract"] or "_No abstract available._",
            "",
        ]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("queries", nargs="*", help="claim/topic queries (PubMed-style keywords)")
    p.add_argument("--file", type=Path, help="text file, one query per line")
    p.add_argument("--max", type=int, default=8, help="results per query (default 8)")
    p.add_argument("--dest", type=Path, default=OUT_ROOT, help=f"output dir ({OUT_ROOT})")
    args = p.parse_args()

    queries = list(args.queries)
    if args.file:
        queries += [ln.strip() for ln in args.file.read_text().splitlines()
                    if ln.strip() and not ln.startswith("#")]
    if not queries:
        raise SystemExit('Give a query, e.g. "KRAS G12C inhibitor resistance", or --file claims.txt')

    for q in queries:
        print(f"[search] {q}")
        try:
            items = search(q, args.max)
        except Exception as e:
            print(f"  failed: {e}")
            continue
        path = save(q, items, args.dest)
        print(f"  {len(items)} results -> {path}")
        time.sleep(1)  # be polite to Europe PMC
    print(f"\nDone. Evidence corpus in {args.dest} (gitignored).")


if __name__ == "__main__":
    main()
