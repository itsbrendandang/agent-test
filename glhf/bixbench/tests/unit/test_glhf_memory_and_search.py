"""Long-term memory and the documentation search of the GLHF swarm (no network, no Docker)."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest
from inspect_ai.tool import ToolError

from bixbench3.inspect_harness.swarm import solver, tools
from bixbench3.inspect_harness.swarm.ledger import Ledger


def test_memory_round_trip_skips_duplicates_and_none(tmp_path: Path) -> None:
    folder = str(tmp_path / "memory")
    assert solver.read_memory(folder) == ""
    assert solver.read_memory(None) == ""
    assert solver.append_memory(folder, "9", "- pin the annotation version\n")
    assert not solver.append_memory(folder, "9", "- pin the annotation version\n")  # already known
    assert not solver.append_memory(folder, "9", "none")
    assert solver.append_memory(folder, "11", "- pin the annotation version\n- index BAMs first\n")
    text = solver.read_memory(folder)
    assert text.count("pin the annotation version") == 1
    assert "## Task 11" in text and "index BAMs first" in text


def test_memory_injects_only_the_newest_lessons(tmp_path: Path) -> None:
    for n in range(400):
        solver.append_memory(str(tmp_path), "1", f"- lesson number {n} " + "x" * 40)
    text = solver.read_memory(str(tmp_path))
    assert len(text) <= solver.MEMORY_INJECT_CHARS
    assert "lesson number 399" in text and "lesson number 0 " not in text


def test_search_is_limited_to_documentation_sites(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: dict[str, Any] = {}

    class Reply:
        status_code = 200

        def json(self) -> dict[str, Any]:
            return {
                "results": [
                    {"url": "https://bioconductor.org/x", "title": "X", "highlights": ["h"]}
                ]
            }

    class Client:
        def __init__(self, **_: object) -> None: ...
        async def __aenter__(self) -> Client:
            return self

        async def __aexit__(self, *_: object) -> None: ...
        async def post(self, url: str, **kwargs: Any) -> Reply:
            sent.update(url=url, **kwargs)
            return Reply()

    monkeypatch.setattr(tools.httpx, "AsyncClient", Client)
    body = asyncio.run(tools.exa_docs("featureCounts -s", "find the manual", "key"))
    assert body["results"][0]["url"].startswith("https://bioconductor.org")
    request = sent["json"]
    assert request["includeDomains"] == tools.DOC_DOMAINS
    assert request["objective"] == "find the manual" and request["type"] == "auto"
    # No journal, preprint server or data repository is on the allow-list.
    blocked = (
        "nature.com",
        "cell.com",
        "biorxiv.org",
        "ncbi.nlm.nih.gov",
        "sciencedirect.com",
        "ebi.ac.uk",
    )
    assert not any(b in d for d in tools.DOC_DOMAINS for b in blocked)


def test_search_without_a_key_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("EXA_API_KEY", raising=False)
    search = tools.search_docs(Ledger(), "scout")
    with pytest.raises(ToolError, match="EXA_API_KEY"):
        asyncio.run(search(query="q", objective="o"))  # type: ignore[arg-type]


def test_past_dev_calls_match_the_documented_shapes(monkeypatch: pytest.MonkeyPatch) -> None:
    from bixbench3.inspect_harness.swarm import past_memory

    calls: list[tuple[str, dict[str, Any], dict[str, str]]] = []

    class Reply:
        def __init__(self, body: dict[str, Any]) -> None:
            self.body = body

        def raise_for_status(self) -> None: ...
        def json(self) -> dict[str, Any]:
            return self.body

    class Client:
        def __init__(self, **_: object) -> None: ...
        async def __aenter__(self) -> Client:
            return self

        async def __aexit__(self, *_: object) -> None: ...
        async def post(self, url: str, *, headers: dict[str, str], json: dict[str, Any]) -> Reply:
            calls.append((url, json, headers))
            if url.endswith("/ingest"):
                return Reply({"ingestionId": "abc"})
            return Reply({"results": [{"content": "pin the annotation version"}, {"content": ""}]})

    monkeypatch.delenv("PAST_API_KEY", raising=False)
    assert not past_memory.enabled()
    monkeypatch.setenv("PAST_API_KEY", "test-key")
    monkeypatch.setattr(past_memory.httpx, "AsyncClient", Client)
    assert asyncio.run(past_memory.remember("9", "- pin the annotation version")) == "abc"
    assert asyncio.run(past_memory.recall("lessons for RNA-seq")) == "pin the annotation version"
    (ingest_url, sent, headers), (recall_url, asked, _) = calls
    assert ingest_url == "https://api.past.dev/api/v1/ingest"
    assert set(sent) == {"id", "content", "label", "timestamp"} and sent["timestamp"].endswith("Z")
    assert headers["Authorization"] == "Bearer test-key"
    assert recall_url == "https://api.past.dev/api/v1/recall"
    assert asked == {"query": "lessons for RNA-seq", "identity": "glhf-swarm", "level": "medium"}
