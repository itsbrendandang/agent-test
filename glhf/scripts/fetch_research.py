#!/usr/bin/env python3
"""Collect reference research papers about THIS project's ideas, as readable text files.

Our app is a multi-agent "swarm" (analyst -> critic -> reconciler) that answers science
questions with a falsification focus, benchmarked on BixBench and inspired by AI-scientist
systems like Kosmos. This script gathers the papers behind those ideas so the team has a
reference corpus (for background, the writeup, or to feed the agents offline).

Source: the arXiv API (free, no key, open access). For each hit it saves:
  * a Markdown file with title, authors, date, link and the full abstract;
  * optionally the full paper text (arXiv's ar5iv HTML, stripped to plain text).

Only Python's standard library is required.

Usage:
  python3 glhf/scripts/fetch_research.py --list                 # show topics
  python3 glhf/scripts/fetch_research.py                        # all topics, abstracts
  python3 glhf/scripts/fetch_research.py --topics swarm falsification
  python3 glhf/scripts/fetch_research.py --full --per-topic 3   # also download full text
"""

from __future__ import annotations

import argparse
import html
import re
import ssl
import time
import urllib.parse
import urllib.request
from pathlib import Path
from xml.etree import ElementTree as ET


def _ssl_ctx() -> ssl.SSLContext:
    """Verified TLS if the system/certifi trust store works, else unverified.

    macOS framework Python often ships without a usable CA bundle, which breaks the
    https redirect arXiv/ar5iv use. We prefer verification and fall back only if it
    is actually broken (fine for fetching public open-access papers)."""
    try:
        import certifi  # type: ignore

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        pass
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(
            urllib.request.Request("https://arxiv.org/robots.txt", headers=UA),
            timeout=10,
            context=ctx,
        ):
            return ctx
    except Exception:
        unverified = ssl.create_default_context()
        unverified.check_hostname = False
        unverified.verify_mode = ssl.CERT_NONE
        return unverified


_SSL = None


def _open(url: str, timeout: int):
    global _SSL
    if _SSL is None:
        _SSL = _ssl_ctx()
    return urllib.request.urlopen(
        urllib.request.Request(url, headers=UA), timeout=timeout, context=_SSL
    )

OUT_ROOT = Path(__file__).resolve().parents[1] / "data" / "research"
ARXIV_API = "http://export.arxiv.org/api/query"
AR5IV = "https://ar5iv.org/abs/"  # HTML render of an arXiv paper
UA = {"User-Agent": "agent-test-research-fetch/1.0 (hackathon reference corpus)"}

# Search queries chosen to match the repo's ideas. Edit freely.
TOPICS: dict[str, str] = {
    "swarm": "multi-agent large language model collaboration",
    "debate": "LLM multi-agent debate improves reasoning",
    "critic": "LLM self-critique verification self-refine",
    "falsification": "automated hypothesis falsification scientific reasoning language model",
    "ai-scientist": "autonomous AI agent scientific discovery research",
    "reproducibility": "reproducing computational biology study from raw data agents",
    "benchmark": "benchmark evaluating LLM agents scientific data analysis",
}


def arxiv_search(query: str, max_results: int) -> list[dict]:
    params = {
        "search_query": f"all:{query}",
        "start": 0,
        "max_results": max_results,
        "sortBy": "relevance",
        "sortOrder": "descending",
    }
    url = f"{ARXIV_API}?{urllib.parse.urlencode(params)}"
    with _open(url, timeout=30) as resp:
        xml = resp.read()
    ns = {"a": "http://www.w3.org/2005/Atom"}
    papers = []
    for entry in ET.fromstring(xml).findall("a:entry", ns):
        def text(tag: str) -> str:
            el = entry.find(f"a:{tag}", ns)
            return (el.text or "").strip() if el is not None else ""

        arxiv_id = text("id").rsplit("/", 1)[-1]
        papers.append(
            {
                "id": arxiv_id,
                "title": " ".join(text("title").split()),
                "authors": [
                    (a.find("a:name", ns).text or "").strip()
                    for a in entry.findall("a:author", ns)
                ],
                "published": text("published")[:10],
                "summary": " ".join(text("summary").split()),
                "link": text("id"),
                "pdf": f"https://arxiv.org/pdf/{arxiv_id}",
            }
        )
    return papers


_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\n{3,}")


def fetch_full_text(arxiv_id: str) -> str | None:
    """Best-effort plain text of the paper from ar5iv's HTML. None if unavailable."""
    base = arxiv_id.split("v")[0]  # drop version suffix for ar5iv
    try:
        with _open(AR5IV + base, timeout=60) as resp:
            htmltext = resp.read().decode("utf-8", "ignore")
    except Exception:
        return None
    body = re.sub(r"(?is)<(script|style).*?</\1>", " ", htmltext)
    body = body.replace("</p>", "\n\n").replace("</div>", "\n")
    text = html.unescape(_TAG.sub(" ", body))
    text = "\n".join(line.strip() for line in text.splitlines())
    text = _WS.sub("\n\n", re.sub(r"[ \t]{2,}", " ", text)).strip()
    return text or None


def safe_name(s: str, limit: int = 70) -> str:
    s = re.sub(r"[^\w\- ]", "", s).strip().replace(" ", "_")
    return s[:limit] or "paper"


def save_paper(topic_dir: Path, p: dict, full: bool) -> None:
    name = f"{p['published']}_{safe_name(p['title'])}"
    md = topic_dir / f"{name}.md"
    md.write_text(
        f"# {p['title']}\n\n"
        f"- **Authors:** {', '.join(p['authors'])}\n"
        f"- **Published:** {p['published']}\n"
        f"- **arXiv:** {p['link']}\n"
        f"- **PDF:** {p['pdf']}\n\n"
        f"## Abstract\n\n{p['summary']}\n",
        encoding="utf-8",
    )
    if full:
        text = fetch_full_text(p["id"])
        if text:
            (topic_dir / f"{name}.fulltext.txt").write_text(text, encoding="utf-8")
            print(f"    + full text ({len(text):,} chars)")
        else:
            print("    - full text unavailable (abstract saved)")
        time.sleep(1)  # be polite to ar5iv


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--topics", nargs="*", help="which topics (default: all; see --list)")
    p.add_argument("--list", action="store_true", help="show topics and exit")
    p.add_argument("--per-topic", type=int, default=5, help="papers per topic (default 5)")
    p.add_argument("--full", action="store_true", help="also download full paper text")
    p.add_argument("--dest", type=Path, default=OUT_ROOT, help=f"output dir ({OUT_ROOT})")
    args = p.parse_args()

    if args.list:
        for key, q in TOPICS.items():
            print(f"  {key:<16} {q}")
        return

    topics = args.topics or list(TOPICS)
    for key in topics:
        if key not in TOPICS:
            raise SystemExit(f"unknown topic {key!r}; try --list")
        topic_dir = args.dest / key
        topic_dir.mkdir(parents=True, exist_ok=True)
        print(f"[{key}] {TOPICS[key]}")
        try:
            papers = arxiv_search(TOPICS[key], args.per_topic)
        except Exception as e:
            print(f"  search failed: {e}")
            continue
        for paper in papers:
            print(f"  - {paper['published']}  {paper['title'][:70]}")
            save_paper(topic_dir, paper, args.full)
        time.sleep(3)  # arXiv asks for ~3s between queries
    print(f"\nDone. Research material in {args.dest} (gitignored).")


if __name__ == "__main__":
    main()
