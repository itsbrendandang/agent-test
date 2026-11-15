#!/usr/bin/env python3
"""Pre-fetch a research EVIDENCE corpus to back up the agents' claims.

Queries several TRUSTED scholarly databases that researchers rely on, merges the
results (de-duplicated by DOI/title), and saves the abstracts. This is a cached
evidence base you can inspect, cite, or demo offline.

Sources (all free, no API key):
  * Europe PMC      - PubMed / NIH (ncbi.nlm.nih.gov) + preprints; the source the
                      app itself uses (engine/src/literature.ts).
  * OpenAlex        - open scholarly catalog across ~all disciplines.
  * Crossref        - the official DOI registry (every publisher).
  * Semantic Scholar- broad corpus with abstracts (AI2). Set S2_API_KEY to avoid
                      rate limits (free key from semanticscholar.org).
  * ClinicalTrials  - clinicaltrials.gov trial records (NIH .gov).
  * bioRxiv/medRxiv - biology/medicine preprints (via Crossref, prefix 10.1101).
  * DOAJ            - Directory of Open Access Journals (peer-reviewed OA articles).
  * DataCite        - research datasets & software (so you can cite the data itself).
  * arXiv           - preprints (physics / CS / quant bio).

For each query it saves one Markdown file with the merged top results (title,
authors, venue, year, DOI/URL, source, abstract). Standard library only.

Usage:
  python3 glhf/scripts/fetch_literature.py "KRAS G12C covalent inhibitor resistance"
  python3 glhf/scripts/fetch_literature.py --file claims.txt          # one query per line
  python3 glhf/scripts/fetch_literature.py "TP53 mutation prognosis" --per-source 5
  python3 glhf/scripts/fetch_literature.py "crispr off-target" --sources europepmc openalex

Query tips: 3-6 keywords, no full sentences.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from xml.etree import ElementTree as ET

OUT_ROOT = Path(__file__).resolve().parents[1] / "data" / "literature"
UA = {"User-Agent": "agent-test-literature-fetch/1.0 (mailto:research@example.com)"}
MAX_ABSTRACT_CHARS = 3000

# --- networking (handles macOS broken CA store) ------------------------------
_SSL: ssl.SSLContext | None = None


def _ssl_ctx() -> ssl.SSLContext:
    try:
        import certifi  # type: ignore

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        pass
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(
            urllib.request.Request("https://api.openalex.org/works?per_page=1", headers=UA),
            timeout=10, context=ctx,
        ):
            return ctx
    except Exception:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx


def _get(url: str, timeout: int = 25, retries: int = 3, headers: dict | None = None) -> bytes:
    global _SSL
    if _SSL is None:
        _SSL = _ssl_ctx()
    hdrs = {**UA, **(headers or {})}
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=hdrs),
                                        timeout=timeout, context=_SSL) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            # 429 (rate limit) and 5xx are transient; back off and retry.
            if e.code in (429, 500, 502, 503) and attempt + 1 < retries:
                import time
                time.sleep(2 ** attempt + 1)
                continue
            raise
    raise RuntimeError("unreachable")


def _tags(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", s or "")).strip()


def _clean_doi(doi: str | None) -> str:
    if not doi:
        return ""
    return re.sub(r"^https?://(dx\.)?doi\.org/", "", doi.strip(), flags=re.I).lower()


# A result: {title, authors, venue, year, doi, url, abstract, source}

# --- source: Europe PMC (PubMed/NIH + preprints) -----------------------------
def src_europepmc(query: str, n: int) -> list[dict]:
    params = {"query": query, "resultType": "core", "format": "json", "pageSize": str(n)}
    url = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" + urllib.parse.urlencode(params)
    body = json.loads(_get(url))
    out = []
    for r in (body.get("resultList") or {}).get("result") or []:
        source = r.get("source", "MED")
        pmid = r.get("pmid", "")
        if source == "MED" and re.fullmatch(r"\d+", pmid or ""):
            link = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
        else:
            link = f"https://europepmc.org/article/{urllib.parse.quote(source)}/{r.get('id','')}"
        out.append({
            "title": _tags(str(r.get("title", ""))),
            "authors": _tags(str(r.get("authorString", ""))),
            "venue": "preprint" if source == "PPR" else (r.get("journalInfo") or {}).get("journal", {}).get("title", ""),
            "year": str(r.get("pubYear", "")),
            "doi": _clean_doi(r.get("doi")),
            "url": link,
            "abstract": _tags(str(r.get("abstractText", "")))[:MAX_ABSTRACT_CHARS],
            "cited_by": int(r.get("citedByCount") or 0),
            "source": "Europe PMC",
        })
    return out


# --- source: OpenAlex --------------------------------------------------------
def _openalex_abstract(inv: dict | None) -> str:
    if not inv:
        return ""
    positions: list[tuple[int, str]] = []
    for word, idxs in inv.items():
        for i in idxs:
            positions.append((i, word))
    positions.sort()
    return " ".join(w for _, w in positions)[:MAX_ABSTRACT_CHARS]


def src_openalex(query: str, n: int) -> list[dict]:
    params = {"search": query, "per_page": str(n)}
    url = "https://api.openalex.org/works?" + urllib.parse.urlencode(params)
    body = json.loads(_get(url))
    out = []
    for w in body.get("results", []):
        authors = ", ".join(a.get("author", {}).get("display_name", "")
                            for a in w.get("authorships", [])[:8])
        venue = ((w.get("primary_location") or {}).get("source") or {}).get("display_name", "") or ""
        out.append({
            "title": _tags(w.get("title") or ""),
            "authors": authors,
            "venue": venue,
            "year": str(w.get("publication_year") or ""),
            "doi": _clean_doi(w.get("doi")),
            "url": w.get("doi") or w.get("id") or "",
            "abstract": _openalex_abstract(w.get("abstract_inverted_index")),
            "cited_by": int(w.get("cited_by_count") or 0),
            "source": "OpenAlex",
        })
    return out


# --- source: Crossref (DOI registry) -----------------------------------------
def src_crossref(query: str, n: int) -> list[dict]:
    params = {"query": query, "rows": str(n)}
    url = "https://api.crossref.org/works?" + urllib.parse.urlencode(params)
    body = json.loads(_get(url))
    out = []
    for it in body.get("message", {}).get("items", []):
        authors = ", ".join(f"{a.get('given','')} {a.get('family','')}".strip()
                            for a in it.get("author", [])[:8])
        year = ""
        parts = (it.get("issued") or {}).get("date-parts") or [[]]
        if parts and parts[0]:
            year = str(parts[0][0])
        out.append({
            "title": _tags(" ".join(it.get("title", [])) or ""),
            "authors": authors,
            "venue": _tags(" ".join(it.get("container-title", [])) or ""),
            "year": year,
            "doi": _clean_doi(it.get("DOI")),
            "url": it.get("URL", ""),
            "abstract": _tags(it.get("abstract", "")),
            "cited_by": int(it.get("is-referenced-by-count") or 0),
            "source": "Crossref",
        })
    return out


# --- source: arXiv -----------------------------------------------------------
def src_arxiv(query: str, n: int) -> list[dict]:
    params = {"search_query": f"all:{query}", "start": "0", "max_results": str(n),
              "sortBy": "relevance", "sortOrder": "descending"}
    url = "http://export.arxiv.org/api/query?" + urllib.parse.urlencode(params)
    ns = {"a": "http://www.w3.org/2005/Atom"}
    out = []
    for e in ET.fromstring(_get(url)).findall("a:entry", ns):
        def t(tag: str) -> str:
            el = e.find(f"a:{tag}", ns)
            return (el.text or "").strip() if el is not None else ""
        out.append({
            "title": " ".join(t("title").split()),
            "authors": ", ".join((a.find("a:name", ns).text or "").strip()
                                 for a in e.findall("a:author", ns)[:8]),
            "venue": "arXiv preprint",
            "year": t("published")[:4],
            "doi": "",
            "url": t("id"),
            "abstract": " ".join(t("summary").split())[:MAX_ABSTRACT_CHARS],
            "source": "arXiv",
        })
    return out


# --- source: Semantic Scholar ------------------------------------------------
def src_semanticscholar(query: str, n: int) -> list[dict]:
    fields = "title,authors,year,venue,abstract,externalIds,url,citationCount"
    params = {"query": query, "limit": str(n), "fields": fields}
    url = "https://api.semanticscholar.org/graph/v1/paper/search?" + urllib.parse.urlencode(params)
    key = os.environ.get("S2_API_KEY") or os.environ.get("SEMANTIC_SCHOLAR_API_KEY")
    body = json.loads(_get(url, headers={"x-api-key": key} if key else None))
    out = []
    for p in body.get("data", []) or []:
        doi = _clean_doi((p.get("externalIds") or {}).get("DOI"))
        out.append({
            "title": _tags(p.get("title") or ""),
            "authors": ", ".join(a.get("name", "") for a in (p.get("authors") or [])[:8]),
            "venue": p.get("venue") or "",
            "year": str(p.get("year") or ""),
            "doi": doi,
            "url": ("https://doi.org/" + doi) if doi else (p.get("url") or ""),
            "abstract": _tags(p.get("abstract") or "")[:MAX_ABSTRACT_CHARS],
            "cited_by": int(p.get("citationCount") or 0),
            "source": "Semantic Scholar",
        })
    return out


# --- source: ClinicalTrials.gov (NIH, .gov) ----------------------------------
def src_clinicaltrials(query: str, n: int) -> list[dict]:
    params = {"query.term": query, "pageSize": str(n), "format": "json"}
    url = "https://clinicaltrials.gov/api/v2/studies?" + urllib.parse.urlencode(params)
    body = json.loads(_get(url))
    out = []
    for s in body.get("studies", []) or []:
        ps = s.get("protocolSection", {})
        ident = ps.get("identificationModule", {})
        nct = ident.get("nctId", "")
        status = ps.get("statusModule", {})
        out.append({
            "title": _tags(ident.get("briefTitle") or ident.get("officialTitle") or ""),
            "authors": _tags((ps.get("sponsorCollaboratorsModule", {})
                              .get("leadSponsor", {}) or {}).get("name", "")),
            "venue": "ClinicalTrials.gov " + (status.get("overallStatus", "") or ""),
            "year": str((status.get("startDateStruct", {}) or {}).get("date", ""))[:4],
            "doi": "",
            "url": f"https://clinicaltrials.gov/study/{nct}" if nct else "",
            "abstract": _tags((ps.get("descriptionModule", {}) or {}).get("briefSummary", ""))[:MAX_ABSTRACT_CHARS],
            "source": "ClinicalTrials.gov",
        })
    return out


# --- source: bioRxiv / medRxiv preprints (via Crossref, prefix 10.1101) -------
def src_biorxiv(query: str, n: int) -> list[dict]:
    # bioRxiv and medRxiv DOIs are registered by Cold Spring Harbor Lab under 10.1101.
    params = {"query": query, "rows": str(n), "filter": "prefix:10.1101"}
    url = "https://api.crossref.org/works?" + urllib.parse.urlencode(params)
    body = json.loads(_get(url))
    out = []
    for it in body.get("message", {}).get("items", []):
        authors = ", ".join(f"{a.get('given','')} {a.get('family','')}".strip()
                            for a in it.get("author", [])[:8])
        parts = (it.get("issued") or {}).get("date-parts") or [[]]
        year = str(parts[0][0]) if parts and parts[0] else ""
        server = _tags(" ".join(it.get("group-title", []) or []) or "bioRxiv/medRxiv")
        out.append({
            "title": _tags(" ".join(it.get("title", [])) or ""),
            "authors": authors,
            "venue": server + " preprint",
            "year": year,
            "doi": _clean_doi(it.get("DOI")),
            "url": it.get("URL", ""),
            "abstract": _tags(it.get("abstract", "")),
            "source": "bioRxiv/medRxiv",
        })
    return out


# --- source: DOAJ (Directory of Open Access Journals) -------------------------
def src_doaj(query: str, n: int) -> list[dict]:
    url = ("https://doaj.org/api/v2/search/articles/"
           + urllib.parse.quote(query, safe="") + "?pageSize=" + str(n))
    body = json.loads(_get(url))
    out = []
    for r in body.get("results", []):
        bj = r.get("bibjson", {})
        doi = ""
        link = ""
        for ident in bj.get("identifier", []):
            if ident.get("type") == "doi":
                doi = _clean_doi(ident.get("id"))
        for lk in bj.get("link", []):
            if lk.get("url"):
                link = lk["url"]
                break
        out.append({
            "title": _tags(bj.get("title") or ""),
            "authors": ", ".join(a.get("name", "") for a in bj.get("author", [])[:8]),
            "venue": _tags((bj.get("journal") or {}).get("title", "")),
            "year": str(bj.get("year") or (bj.get("journal") or {}).get("year", "")),
            "doi": doi,
            "url": ("https://doi.org/" + doi) if doi else link,
            "abstract": _tags(bj.get("abstract") or "")[:MAX_ABSTRACT_CHARS],
            "source": "DOAJ",
        })
    return out


# --- source: DataCite (datasets & software DOIs) -----------------------------
def src_datacite(query: str, n: int) -> list[dict]:
    params = {"query": query, "page[size]": str(n)}
    url = "https://api.datacite.org/dois?" + urllib.parse.urlencode(params)
    body = json.loads(_get(url))
    out = []
    for d in body.get("data", []):
        a = d.get("attributes", {})
        titles = a.get("titles") or [{}]
        descs = a.get("descriptions") or [{}]
        doi = _clean_doi(a.get("doi"))
        out.append({
            "title": _tags(titles[0].get("title", "")),
            "authors": ", ".join(c.get("name", "") for c in a.get("creators", [])[:8]),
            "venue": _tags(str(a.get("publisher", "")) or "dataset"),
            "year": str(a.get("publicationYear", "")),
            "doi": doi,
            "url": a.get("url") or (("https://doi.org/" + doi) if doi else ""),
            "abstract": _tags(descs[0].get("description", ""))[:MAX_ABSTRACT_CHARS],
            "source": "DataCite",
        })
    return out


SOURCES = {
    "europepmc": src_europepmc,
    "openalex": src_openalex,
    "crossref": src_crossref,
    "semanticscholar": src_semanticscholar,
    "clinicaltrials": src_clinicaltrials,
    "biorxiv": src_biorxiv,
    "doaj": src_doaj,
    "datacite": src_datacite,
    "arxiv": src_arxiv,
}


def _norm_title(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def merge(results: list[dict]) -> list[dict]:
    """De-dupe across sources by DOI, then by normalised title. Prefer entries with abstracts."""
    best: dict[str, dict] = {}
    for r in results:
        key = r["doi"] or _norm_title(r["title"])
        if not key:
            continue
        cb = int(r.get("cited_by", 0) or 0)
        if key not in best:
            r["cited_by"] = cb
            best[key] = r
        else:
            # merge duplicates: keep the richer abstract, the higher citation count,
            # and remember every source the paper appeared in.
            cur = best[key]
            cur_cb = int(cur.get("cited_by", 0) or 0)
            merged_sources = cur["source"] if r["source"] in cur["source"] else f"{cur['source']} + {r['source']}"
            winner = r if len(r["abstract"]) > len(cur["abstract"]) else cur
            winner["source"] = merged_sources
            winner["cited_by"] = max(cb, cur_cb)
            best[key] = winner
    # sort: abstracts first, then most-cited, then newest.
    return sorted(best.values(),
                  key=lambda r: (bool(r["abstract"]), int(r.get("cited_by", 0) or 0), r["year"]),
                  reverse=True)


def safe_name(s: str, limit: int = 70) -> str:
    s = re.sub(r"[^\w\- ]", "", s).strip().replace(" ", "_")
    return s[:limit] or "query"


def save(query: str, items: list[dict], sources: list[str], dest: Path) -> Path:
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / f"{safe_name(query)}.md"
    lines = [f"# Evidence for: {query}", "",
             f"_Sources: {', '.join(sources)}. {len(items)} unique results._", ""]
    for i, it in enumerate(items, 1):
        where = ", ".join(x for x in [it["venue"], it["year"]] if x)
        cb = int(it.get("cited_by", 0) or 0)
        cites = f"  ·  cited by {cb}" if cb else ""
        lines += [
            f"## {i}. {it['title']}",
            f"- {it['authors']}" if it["authors"] else "",
            f"- {where}  ·  **{it['source']}**{cites}",
            f"- {('https://doi.org/' + it['doi']) if it['doi'] else it['url']}",
            "",
            it["abstract"] or "_No abstract available._",
            "",
        ]
    path.write_text("\n".join(l for l in lines if l is not None), encoding="utf-8")
    return path


def save_json(query: str, items: list[dict], dest: Path) -> Path:
    """Machine-readable version, so the app/agents can read the evidence programmatically."""
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / f"{safe_name(query)}.json"
    path.write_text(json.dumps({"query": query, "results": items}, indent=2, ensure_ascii=False),
                    encoding="utf-8")
    return path


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("queries", nargs="*", help="claim/topic queries (keywords)")
    p.add_argument("--file", type=Path, help="text file, one query per line")
    p.add_argument("--sources", nargs="*", default=list(SOURCES),
                   choices=list(SOURCES), help="which databases (default: all)")
    p.add_argument("--per-source", type=int, default=5, help="results per source (default 5)")
    p.add_argument("--json", action="store_true", help="also write a machine-readable .json")
    p.add_argument("--dest", type=Path, default=OUT_ROOT, help=f"output dir ({OUT_ROOT})")
    args = p.parse_args()

    queries = list(args.queries)
    if args.file:
        queries += [ln.strip() for ln in args.file.read_text().splitlines()
                    if ln.strip() and not ln.startswith("#")]
    if not queries:
        raise SystemExit('Give a query, e.g. "KRAS G12C inhibitor resistance", or --file claims.txt')

    from concurrent.futures import ThreadPoolExecutor

    for q in queries:
        print(f"[query] {q}")
        collected: list[dict] = []

        def fetch_one(name: str) -> tuple[str, list[dict] | str]:
            try:
                return name, SOURCES[name](q, args.per_source)
            except Exception as e:  # keep the other sources going
                return name, f"failed: {e}"

        # Query all sources at once instead of one-by-one (much faster).
        with ThreadPoolExecutor(max_workers=len(args.sources)) as pool:
            for name, result in pool.map(fetch_one, args.sources):
                if isinstance(result, str):
                    print(f"  {name:<16} {result}")
                else:
                    collected += result
                    print(f"  {name:<16} {len(result)} results")

        merged = merge(collected)
        path = save(q, merged, args.sources, args.dest)
        print(f"  -> {len(merged)} unique -> {path}")
        if args.json:
            print(f"  -> json -> {save_json(q, merged, args.dest)}")
    print(f"\nDone. Evidence corpus in {args.dest} (gitignored).")


if __name__ == "__main__":
    main()
