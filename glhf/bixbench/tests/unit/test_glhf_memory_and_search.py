"""Long-term memory and the documentation search of the GLHF swarm (no network, no Docker)."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest
from inspect_ai.tool import ToolError

from bixbench3.inspect_harness.models import NetworkAccessPolicy
from bixbench3.inspect_harness.swarm import memory, tools
from bixbench3.inspect_harness.swarm.ledger import Ledger
from bixbench3.network_gateway.policy import RESTRICTED_DOMAIN_SCOPES


def test_memory_round_trip_skips_duplicates_and_none(tmp_path: Path) -> None:
    folder = str(tmp_path / "memory")
    assert memory.read_memory(folder) == ""
    assert memory.read_memory(None) == ""
    assert memory.append_memory(folder, "9", "- pin the annotation version\n")
    assert not memory.append_memory(folder, "9", "- pin the annotation version\n")  # known
    assert not memory.append_memory(folder, "9", "none")
    assert memory.append_memory(folder, "11", "- pin the annotation version\n- index BAMs first\n")
    text = memory.read_memory(folder)
    assert text.count("pin the annotation version") == 1 and "index BAMs first" in text
    assert "## Task 11" in (tmp_path / "memory" / memory.MEMORY_FILE).read_text()


def test_memory_injects_only_the_newest_lessons(tmp_path: Path) -> None:
    words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
    for n in range(400):
        name = " ".join(words[int(d)] for d in str(n))
        memory.append_memory(str(tmp_path), "1", f"- lesson number {name} end " + "x" * 40)
    text = memory.read_memory(str(tmp_path))
    assert len(text) <= memory.MEMORY_INJECT_CHARS
    assert "lesson number three nine nine end" in text and "lesson number zero end" not in text


def test_lessons_from_the_same_task_are_never_injected(tmp_path: Path) -> None:
    folder = str(tmp_path)
    memory.append_memory(folder, "9", "- the staged sample sheet has extra rows; compare it first")
    memory.append_memory(folder, "11", "- index the alignments before counting")
    memory.append_memory(folder, "9", "- check line endings of the inputs")
    again = memory.read_memory(folder, "9")  # a rerun of task 9 sees only task 11's lesson
    assert again == "- index the alignments before counting"
    other = memory.read_memory(folder, "16")
    assert "extra rows" in other and "line endings" in other and "index the alignments" in other
    assert memory.read_memory(folder, "1") == other  # "1" is not a prefix match for "11"


@pytest.mark.parametrize(
    "line",
    [
        "TP53 goes down in the knockdown samples",
        "ENSG00000141510 is missing from the annotation",
        "the contrast gives 1234 significant genes",
        "padj for the top gene was 0.0012",
        "mapping rate was 95% for all samples",
        "our score was good after fixing the header",
        "the data are in GSE123456",
        "sample S9 is not in the sheet",
        "check against the ground truth table",
    ],
)
def test_lesson_lines_that_look_like_results_are_rejected(line: str) -> None:
    assert memory.lesson_rejection(line) is not None
    kept, rejected = memory.filter_lessons(f"- pin the annotation version\n- {line}\n")
    assert kept == ["- pin the annotation version"]
    assert [r["line"] for r in rejected] == [f"- {line}"] and rejected[0]["reason"]


@pytest.mark.parametrize(
    "line",
    [
        "Check line endings first; use the csv module and strip fields.",
        "Pin STAR 2.7.10b and run it with 8 threads.",
        "HISAT2 needs the GRCh38 index built before the pilot.",
        "Have the pipeline script write a short METHODS.md itself.",
        "Python 3.12 has no pandas in the slim image; use the csv module.",
    ],
)
def test_process_lessons_pass_the_filter(line: str) -> None:
    assert memory.lesson_rejection(line) is None


def test_rejected_lines_are_not_saved_or_injected(tmp_path: Path) -> None:
    folder = str(tmp_path)
    assert memory.append_memory(folder, "9", "- BRCA1 is the top hit\n- sort outputs by gene id\n")
    saved = (tmp_path / memory.MEMORY_FILE).read_text()
    assert "BRCA1" not in saved and "sort outputs by gene id" in saved
    assert not memory.append_memory(folder, "9", "- BRCA1 is the top hit\n")  # nothing left
    # A hand-edited file cannot inject what the filter refuses either.
    with (tmp_path / memory.MEMORY_FILE).open("a") as fh:
        fh.write("\n## Task 11, 2026-01-01 00:00 UTC\n- MYC2 was up 3.251 fold\n")
    assert "MYC2" not in memory.read_memory(folder, "16")


class _ExaReply:
    status_code = 200

    def __init__(self, urls: list[str]) -> None:
        self.urls = urls

    def json(self) -> dict[str, Any]:
        return {"results": [{"url": u, "title": u, "highlights": ["text"]} for u in self.urls]}


def _fake_exa(monkeypatch: pytest.MonkeyPatch, urls: list[str]) -> dict[str, Any]:
    sent: dict[str, Any] = {"calls": 0}

    class Client:
        def __init__(self, **_: object) -> None: ...
        async def __aenter__(self) -> Client:
            return self

        async def __aexit__(self, *_: object) -> None: ...
        async def post(self, url: str, **kwargs: Any) -> _ExaReply:
            sent.update(url=url, calls=sent["calls"] + 1, **kwargs)
            return _ExaReply(urls)

    async def no_save(_: Ledger) -> None: ...

    monkeypatch.setattr(tools.httpx, "AsyncClient", Client)
    monkeypatch.setattr(tools, "save_ledger", no_save)  # no sandbox in unit tests
    monkeypatch.setenv("EXA_API_KEY", "test-key")
    return sent


def test_search_is_limited_to_documentation_sites(monkeypatch: pytest.MonkeyPatch) -> None:
    sent = _fake_exa(monkeypatch, ["https://bioconductor.org/x"])
    body = asyncio.run(tools.exa_docs("featureCounts -s", "find the manual", "key"))
    assert body["results"][0]["url"].startswith("https://bioconductor.org")
    request = sent["json"]
    assert request["includeDomains"] == tools.DOC_DOMAINS
    assert request["objective"] == "find the manual" and request["type"] == "auto"
    # No journal, preprint server, code host or data repository is on the allow-list, and
    # nothing the benchmark's own network gate restricts.
    blocked = (
        "nature.com",
        "cell.com",
        "biorxiv.org",
        "ncbi.nlm.nih.gov",
        "sciencedirect.com",
        "ebi.ac.uk",
        "github.com",
        "ensembl.org",
        "broadinstitute.org",
        "gsea-msigdb.org",
        *RESTRICTED_DOMAIN_SCOPES,
    )
    for domain in tools.DOC_DOMAINS:
        assert not any(domain == b or domain.endswith("." + b) for b in blocked), domain
        assert tools.result_block_reason(f"https://{domain}/page") is None


def test_search_drops_results_outside_the_allow_list_and_the_case_policy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The search engine is not trusted to honour includeDomains: every URL is checked again.
    _fake_exa(
        monkeypatch,
        [
            "https://subread.readthedocs.io/en/latest/featureCounts.html",
            "https://github.com/authors/paper-code/blob/main/results.csv",
            "https://zenodo.org/records/1",
            "https://www.nature.com/articles/x",
            "https://bioconductor.org.evil.example/x",
            "https://answers.readthedocs.io/table.html",
            "https://rdrr.io/answer/sheet.csv",
            "ftp://bioconductor.org/x",
        ],
    )
    policy = NetworkAccessPolicy(
        answer_source_domains=["answers.readthedocs.io"],
        answer_source_urls=["https://rdrr.io/answer/sheet.csv"],
        restricted_domain_scopes=["github.com"],
    )
    ledger = Ledger()
    search = tools.search_docs(ledger, "scout", policy, "10.1234/abc.5")
    text = asyncio.run(search(query="featureCounts strandedness", objective="manual first"))  # type: ignore[arg-type]
    assert "subread.readthedocs.io" in text
    for leaked in ("github.com", "zenodo", "nature.com", "evil.example", "answers.", "rdrr.io"):
        assert leaked not in text
    event = ledger.events[-1]
    assert event["kind"] == "search"
    assert event["urls"] == ["https://subread.readthedocs.io/en/latest/featureCounts.html"]
    assert len(event["dropped"]) == 7  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "query",
    [
        "REST knockdown glioblastoma 10.1038/s41586-020-1234-5",
        "GSE123456 count matrix",
        "download SRR1234567 fastq",
        "PRJNA123456 sample sheet",
        "E-MTAB-1234 processed data",
        "PMID: 31234567 supplementary table",
        "biorxiv preprint differential expression table",
        "paper with doi 10.1234/ABC.5",
    ],
)
def test_search_refuses_study_identifiers(monkeypatch: pytest.MonkeyPatch, query: str) -> None:
    sent = _fake_exa(monkeypatch, ["https://bioconductor.org/x"])
    ledger = Ledger()
    search = tools.search_docs(ledger, "scout", None, "10.1234/abc.5")
    with pytest.raises(ToolError, match="search refused"):
        asyncio.run(search(query=query, objective="o"))  # type: ignore[arg-type]
    assert sent["calls"] == 0  # refused before anything left the runner
    assert ledger.events[-1]["kind"] == "search.refused"
    # The objective is checked too.
    with pytest.raises(ToolError, match="search refused"):
        asyncio.run(search(query="DESeq2 design formula", objective=query))  # type: ignore[arg-type]


def test_search_calls_are_capped_per_run(monkeypatch: pytest.MonkeyPatch) -> None:
    sent = _fake_exa(monkeypatch, ["https://bioconductor.org/x"])
    ledger = Ledger()
    scout, pilot = tools.search_docs(ledger, "scout"), tools.search_docs(ledger, "pilot")
    for n in range(tools.MAX_SEARCHES):
        role = scout if n % 2 else pilot  # the cap is shared by all roles
        asyncio.run(role(query="DESeq2 lfcShrink apeglm", objective="o"))  # type: ignore[arg-type]
    with pytest.raises(ToolError, match="limit of"):
        asyncio.run(scout(query="DESeq2 lfcShrink apeglm", objective="o"))  # type: ignore[arg-type]
    assert sent["calls"] == tools.MAX_SEARCHES
    assert ledger.events[-1]["kind"] == "search.refused"


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
            return Reply(
                {
                    "results": [
                        {"content": "pin the annotation version"},
                        {"content": ""},
                        {  # built from an earlier run on task 9: by source id
                            "content": "compare the sheet with the data first",
                            "sources": [{"sourceId": "glhf-lessons-9-20260101T000000Z"}],
                        },
                        {"content": "Applies to task 9: strip fields."},  # by its text
                        {  # from task 91, which is another task
                            "content": "index alignments first",
                            "sources": [{"sourceId": "glhf-lessons-91-20260101T000000Z"}],
                        },
                        {"content": "BRCA1 was the top hit"},  # a result, not a lesson
                    ]
                }
            )

    monkeypatch.delenv("PAST_API_KEY", raising=False)
    assert not past_memory.enabled()
    monkeypatch.setenv("PAST_API_KEY", "test-key")
    monkeypatch.setattr(past_memory.httpx, "AsyncClient", Client)
    assert asyncio.run(past_memory.remember("9", "- pin the annotation version")) == "abc"
    assert (
        asyncio.run(past_memory.recall("lessons for RNA-seq"))
        == "pin the annotation version\ncompare the sheet with the data first\n"
        "Applies to task 9: strip fields.\nindex alignments first"
    )
    # A run on task 9 gets nothing that came from task 9, and the default query is fixed text.
    assert (
        asyncio.run(past_memory.recall(task_id="9"))
        == "pin the annotation version\nindex alignments first"
    )
    assert calls[-1][1]["query"] == past_memory.RECALL_QUERY
    del calls[2:]
    (ingest_url, sent, headers), (recall_url, asked, _) = calls
    assert ingest_url == "https://api.past.dev/api/v1/ingest"
    assert set(sent) == {"id", "content", "label", "timestamp"} and sent["timestamp"].endswith("Z")
    assert headers["Authorization"] == "Bearer test-key"
    assert recall_url == "https://api.past.dev/api/v1/recall"
    assert asked == {"query": "lessons for RNA-seq", "identity": "glhf-swarm", "level": "medium"}
