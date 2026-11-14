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


def _approve_all(folder: str | Path) -> None:
    _, refused = memory.decide(folder, None, approve=True)
    assert refused == []


def _save(folder: str, task: str, lessons: str, context: tuple[str, ...] = ()) -> int:
    """What the tests call "saved": queued by a run, then approved by a person."""
    queued = memory.add_pending(folder, task, lessons, context)
    _approve_all(folder)
    return queued


def test_a_run_only_queues_lessons_and_nothing_is_injected_before_approval(tmp_path: Path) -> None:
    folder = str(tmp_path / "memory")
    assert memory.read_memory(folder) == "" and memory.read_memory(None) == ""
    assert memory.add_pending(folder, "9", "- pin the annotation version\n") == 1
    assert memory.add_pending(folder, "9", "- pin the annotation version\n") == 0  # known
    assert memory.add_pending(folder, "9", "none") == 0
    # Queued, not saved: the approved file does not exist and no run is shown the lesson.
    assert not (tmp_path / "memory" / memory.MEMORY_FILE).exists()
    assert memory.read_memory(folder) == "" and memory.read_memory(folder, "16") == ""
    assert [(n, s.task, line) for n, s, line in memory.pending_lessons(folder)] == [
        (1, "9", "- pin the annotation version")
    ]
    assert memory.add_pending(folder, "11", "- index BAMs first\n- sort by name\n") == 2
    approved, refused = memory.decide(folder, [1, 3], approve=True)
    assert refused == [] and [(s.task, s.lines) for s in approved] == [
        ("9", ["- pin the annotation version"]),
        ("11", ["- sort by name"]),
    ]
    assert memory.read_memory(folder) == "- pin the annotation version\n- sort by name"
    # What was not chosen is still waiting, renumbered; rejecting it removes it for good.
    assert [line for _, _, line in memory.pending_lessons(folder)] == ["- index BAMs first"]
    memory.decide(folder, [1], approve=False)
    assert memory.pending_lessons(folder) == []
    assert "index BAMs first" not in memory.read_memory(folder)
    # An approved lesson is not queued again by a later run.
    assert memory.add_pending(folder, "16", "- sort by name\n") == 0
    with pytest.raises(ValueError, match="no pending lesson"):
        memory.decide(folder, [7], approve=True)


def test_the_memory_command_lists_approves_and_rejects(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("PAST_API_KEY", raising=False)
    folder = str(tmp_path)
    memory.add_pending(folder, "9", "- pin the annotation version\n- index BAMs first\n", ["11"])
    assert memory.main(["--dir", folder, "list"]) == 0
    listing = capsys.readouterr().out
    assert "  1  [task 9, context 11] - pin the annotation version" in listing
    assert "2 pending" in listing
    assert memory.main(["--dir", folder, "approve", "2"]) == 0
    assert memory.main(["--dir", folder, "reject", "1"]) == 0
    assert memory.read_memory(folder, "16") == "- index BAMs first"
    assert memory.main(["--dir", folder, "approve", "5"]) == 2  # no such number
    # A line the filter refuses cannot be approved: it could never be injected anyway.
    (tmp_path / memory.PENDING_FILE).write_text("## Task 9, t\n- BRCA1 is the top hit\n")
    assert memory.main(["--dir", folder, "approve-all"]) == 1
    assert "BRCA1" not in (tmp_path / memory.MEMORY_FILE).read_text()
    assert len(memory.pending_lessons(folder)) == 1


def test_approved_lessons_go_to_past_dev_only_on_approval(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from bixbench3.inspect_harness.swarm import past_memory

    sent: list[tuple[str, str, list[str]]] = []

    async def remember(task_id: str, lessons: str, context: list[str]) -> str:
        sent.append((task_id, lessons, list(context)))
        return "receipt"

    monkeypatch.setenv("PAST_API_KEY", "test-key")
    monkeypatch.setattr(past_memory, "remember", remember)
    folder = str(tmp_path)
    memory.add_pending(folder, "9", "- pin the annotation version\n", ["11"])
    assert sent == []  # a run sends nothing
    assert memory.main(["--dir", folder, "--no-past", "list"]) == 0 and sent == []
    assert memory.main(["--dir", folder, "approve-all"]) == 0
    assert sent == [("9", "- pin the annotation version", ["11"])]


def test_memory_injects_only_the_newest_lessons(tmp_path: Path) -> None:
    words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
    for n in range(400):
        name = " ".join(words[int(d)] for d in str(n))
        memory.add_pending(str(tmp_path), "1", f"- lesson number {name} end " + "x" * 40)
    _approve_all(tmp_path)
    text = memory.read_memory(str(tmp_path))
    assert len(text) <= memory.MEMORY_INJECT_CHARS
    assert "lesson number three nine nine end" in text and "lesson number zero end" not in text


def test_lessons_from_the_same_task_are_never_injected(tmp_path: Path) -> None:
    folder = str(tmp_path)
    _save(folder, "9", "- the staged sample sheet has extra rows; compare it first")
    _save(folder, "11", "- index the alignments before counting")
    _save(folder, "9", "- check line endings of the inputs")
    again = memory.read_memory(folder, "9")  # a rerun of task 9 sees only task 11's lesson
    assert again == "- index the alignments before counting"
    other = memory.read_memory(folder, "16")
    assert "extra rows" in other and "line endings" in other and "index the alignments" in other
    assert memory.read_memory(folder, "1") == other  # "1" is not a prefix match for "11"


def test_a_lesson_cannot_return_to_its_task_through_another_task(tmp_path: Path) -> None:
    # Laundering: a run on Y is shown X's lessons, rephrases them into its own, and they are
    # saved under Y. Without provenance a later run on X would be shown them.
    folder = str(tmp_path)
    _save(folder, "X", "- compare the sheet with the data first")
    seen_by_y = memory.load_memory(folder, "Y")
    assert seen_by_y.text and seen_by_y.sources == {"X"}
    _save(folder, "Y", "- always compare the sheet and the data before planning", seen_by_y.sources)
    assert "## Task Y" in (tmp_path / memory.MEMORY_FILE).read_text()
    assert "; context: X" in (tmp_path / memory.MEMORY_FILE).read_text()
    assert memory.read_memory(folder, "X") == ""  # neither its own lesson nor Y's rephrasing
    # One more hop: Z read Y's lesson, whose context was X; the chain still excludes X.
    seen_by_z = memory.load_memory(folder, "Z")
    assert seen_by_z.sources == {"X", "Y"}
    _save(folder, "Z", "- plan only after the sheet was compared", seen_by_z.sources)
    assert memory.read_memory(folder, "X") == ""
    assert "plan only after" in memory.read_memory(folder, "W")
    # A run that read nothing has no context, and its lessons reach every other task.
    _save(folder, "V", "- write the notebook as steps run")
    assert memory.read_memory(folder, "X") == "- write the notebook as steps run"


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
        # The lines the second review got through the filter.
        "The answer has 312 DE genes; top hit Sox2 with fold change 2.31.",
        "Final table: 1,234 significant genes at FDR 0.05, most up-regulated is MYC.",
        "Expected output row for Trp53: log2FC -1.8, padj 3e-5",
        "Use tp53, brca1 and egfr as the markers",
        "GSE12345_counts.tsv has the matrix",
        "Sample ctrl_rep3 is an outlier and must be dropped to match the paper",
        # One cause each: thousands separator, lower-case gene, accession before "_",
        # sample name, scientific notation, disguised accession.
        "the table had 1,234 rows after filtering",
        "use brca1 first",
        "read SRR1234567_1.fastq.gz before the others",
        "drop KO_3 before counting",
        "set the cutoff to 3e-5",
        "the data are in GSE\u200b12345",
        "the data are in gse 12345",
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
        "Use GENCODE v32 with DESeq2 1.40.2 and bedtools v2.31.0.",
        "Files can be UTF-8 with a byte-order mark; open them with utf-8-sig.",
    ],
)
def test_process_lessons_pass_the_filter(line: str) -> None:
    assert memory.lesson_rejection(line) is None


def test_the_lessons_in_the_repository_pass_the_filter() -> None:
    # glhf/memory/lessons.md is read through the filter: a line it refuses is silently unused.
    file = memory.DEFAULT_DIR / memory.MEMORY_FILE
    assert file.exists(), file
    lines = [
        line for line in file.read_text().splitlines() if line.strip() and not line.startswith("#")
    ]
    assert lines and [line for line in lines if memory.lesson_rejection(line)] == []


def test_rejected_lines_are_not_queued_or_injected(tmp_path: Path) -> None:
    folder = str(tmp_path)
    assert memory.add_pending(folder, "9", "- BRCA1 is the top hit\n- sort outputs by gene id\n")
    queued = (tmp_path / memory.PENDING_FILE).read_text()
    assert "BRCA1" not in queued and "sort outputs by gene id" in queued
    assert memory.add_pending(folder, "9", "- BRCA1 is the top hit\n") == 0  # nothing left
    _approve_all(folder)
    # A hand-edited approved file cannot inject what the filter refuses either.
    with (tmp_path / memory.MEMORY_FILE).open("a") as fh:
        fh.write("\n## Task 11, 2026-01-01 00:00 UTC\n- MYC2 was up 3.251 fold\n")
    assert "MYC2" not in memory.read_memory(folder, "16")
    # And the pending file is never read for injection, whatever it holds.
    (tmp_path / memory.PENDING_FILE).write_text("## Task 11, t\n- use the fast aligner mode\n")
    assert "fast aligner" not in memory.read_memory(folder, "16")


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
    # No journal, preprint server, code host, code mirror, data repository, package index or
    # question-and-answer site is on the allow-list, and nothing the benchmark's own network
    # gate restricts.
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
        "rdrr.io",
        "pypi.org",
        "r-project.org",
        "biostars.org",
        "stackoverflow.com",
        "stackexchange.com",
        *RESTRICTED_DOMAIN_SCOPES,
    )
    for domain in tools.DOC_DOMAINS:
        assert not any(domain == b or domain.endswith("." + b) for b in blocked), domain


@pytest.mark.parametrize(
    "url",
    [
        "https://bioconductor.org/packages/release/bioc/html/DESeq2.html",
        "https://www.bioconductor.org/packages/release/bioc/vignettes/DESeq2/inst/doc/DESeq2.html",
        "https://bioconductor.org/packages/3.19/bioc/manuals/edgeR/man/edgeR.pdf",
        "https://bioconductor.org/packages/devel/bioc/html/limma.html",
        "https://subread.readthedocs.io/en/latest/featureCounts.html",
        "https://scanpy.readthedocs.io/en/stable/api.html",
        "https://www.htslib.org/doc/samtools-view.html",
        "https://nf-co.re/rnaseq/usage",
        "https://docs.python.org/3/library/csv.html",
    ],
)
def test_tool_manuals_are_allowed(url: str) -> None:
    assert tools.result_block_reason(url) is None


@pytest.mark.parametrize(
    ("url", "why"),
    [
        # The hosts and paths the second review showed could carry a study's code or data.
        ("https://rdrr.io/github/authors/paper-code/man/results.html", "not on the documentation"),
        ("https://paper-code.readthedocs.io/en/latest/results.html", "named tool manuals"),
        ("https://readthedocs.io/projects/paper-code/", "named tool manuals"),
        (
            "https://bioconductor.org/packages/release/data/experiment/html/airway.html",
            "outside the documentation part",
        ),
        (
            "https://bioconductor.org/packages/release/workflows/html/rnaseqGene.html",
            "outside the documentation part",
        ),
        ("https://support.bioconductor.org/p/123456/", "not its subdomains"),
        ("https://cran.r-project.org/web/packages/somedata/vignettes/x.html", "not on the doc"),
        ("https://pypi.org/project/paper-data/", "not on the documentation"),
        ("https://www.biostars.org/p/9512345/", "not on the documentation"),
        ("https://stackoverflow.com/questions/1/x", "not on the documentation"),
        # Host confusion: a URL parser and a browser can disagree about these.
        ("https://evil.com\\@readthedocs.io/", "backslash"),
        ("https://evil.com\\@subread.readthedocs.io/x", "backslash"),
        ("https://subread.readthedocs.io@evil.com/x", "user information"),
        ("https://user:pw@subread.readthedocs.io/x", "user information"),
        ("https://subread.readthedocs.io /x", "space"),
        ("https://bioconductor.org.evil.example/packages/release/bioc/x", "not on the doc"),
        ("ftp://bioconductor.org/packages/release/bioc/x", "not an http"),
    ],
)
def test_results_that_can_carry_a_study_are_dropped(url: str, why: str) -> None:
    reason = tools.result_block_reason(url)
    assert reason is not None and why in reason, reason


def test_the_case_policy_and_the_restricted_hosts_win_over_the_allow_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manual = "https://subread.readthedocs.io/en/latest/featureCounts.html"
    assert tools.result_block_reason(manual) is None
    # A host the benchmark's gate restricts is dropped even if it were put on the allow-list.
    monkeypatch.setattr(tools, "DOC_DOMAINS", [*tools.DOC_DOMAINS, "github.com"])
    assert tools.result_block_reason("https://github.com/x/y") == (
        "host is a restricted code or data host"
    )
    # So is a host the case itself restricts or names as an answer source.
    policy = NetworkAccessPolicy(restricted_domain_scopes=["readthedocs.io"])
    assert tools.result_block_reason(manual, policy) == "host is a restricted code or data host"
    policy = NetworkAccessPolicy(answer_source_domains=["subread.readthedocs.io"])
    assert tools.result_block_reason(manual, policy) == "host is an answer source for this task"
    policy = NetworkAccessPolicy(answer_source_urls=["https://subread.readthedocs.io/en/latest"])
    assert tools.result_block_reason(manual, policy) == "URL is an answer source for this task"


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
            "https://salmon.readthedocs.io/answer/sheet.csv",
            "ftp://bioconductor.org/x",
            "https://rdrr.io/github/authors/paper/",
        ],
    )
    policy = NetworkAccessPolicy(
        answer_source_urls=["https://salmon.readthedocs.io/answer/sheet.csv"],
        restricted_domain_scopes=["github.com"],
    )
    ledger = Ledger()
    search = tools.search_docs(ledger, "scout", policy, "10.1234/abc.5")
    text = asyncio.run(search(query="featureCounts strandedness", objective="manual first"))  # type: ignore[arg-type]
    assert "subread.readthedocs.io" in text
    for leaked in ("github.com", "zenodo", "nature.com", "evil.example", "answers.", "salmon."):
        assert leaked not in text
    assert "rdrr.io" not in text
    event = ledger.events[-1]
    assert event["kind"] == "search"
    assert event["urls"] == ["https://subread.readthedocs.io/en/latest/featureCounts.html"]
    assert len(event["dropped"]) == 8  # type: ignore[arg-type]


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
        # The disguises the second review got through.
        "GSE12345_raw_counts.txt format",
        "SRR1234567_1.fastq.gz",
        "PRJNA123456_meta",
        "E-MTAB-1234_sdrf",
        "GSE 12345",
        "gse-12345",
        "GSE\u200b12345",
        "\uff27\uff33\uff25\uff11\uff12\uff13\uff14\uff15",  # full-width GSE12345
        "doi 10.1038 s41586-020-2077-3",
        "10.1038%2Fs41586-020-2077-3",
        "x_10.1038/s41586-020-2077-3",
        "pubmed id 31234567",
        "PXD012345 proteomics",
        "syn1234567 processed tables",
        "MSV000081234",
        "10.1234 abc.5 supplementary",  # the case's own DOI with the slash removed
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


@pytest.mark.parametrize(
    "query",
    [
        "featureCounts reverse-stranded paired-end -s 2 -p option",
        "STAR 2.7.10b --sjdbOverhang 100 meaning",
        "DESeq2 1.40.2 lfcShrink apeglm",
        "samtools GPL-3 license sort by name",
        "bedtools v2.31.0 intersect -wa",
        "python 3.10.12 csv module utf-8-sig",
        "error 137 out of memory with 16384 MB",
    ],
)
def test_ordinary_documentation_queries_are_not_refused(query: str) -> None:
    assert tools.query_refusal(query, "10.1234/abc.5") is None


def test_search_refuses_the_title_and_the_authors_when_the_case_gives_them() -> None:
    title = "REST repression of neuronal genes drives glioblastoma stem cell maintenance"
    refuse = tools.query_refusal
    assert "title" in str(refuse("glioblastoma stem cell maintenance paper", None, [title]))
    assert "title" in str(refuse("REST  repression-of neuronal targets", None, [title]))
    assert "author" in str(refuse("differential expression Okonkwo 2021", None, [], ["Okonkwo"]))
    # Two shared words, or three very common ones, are not the title.
    assert refuse("glioblastoma stem markers", None, [title]) is None
    assert refuse("analysis of the count data", None, ["An analysis of the proteome"]) is None
    assert refuse("DESeq2 design formula", None, [title], ["Okonkwo", "Li"]) is None


def test_search_calls_are_capped_per_run(monkeypatch: pytest.MonkeyPatch) -> None:
    sent = _fake_exa(monkeypatch, ["https://www.htslib.org/doc/samtools.html"])
    ledger = Ledger()
    scout, pilot = tools.search_docs(ledger, "scout"), tools.search_docs(ledger, "pilot")
    for n in range(tools.MAX_SEARCHES):
        role = scout if n % 2 else pilot  # the cap is shared by all roles
        asyncio.run(role(query="DESeq2 lfcShrink apeglm", objective="o"))  # type: ignore[arg-type]
    with pytest.raises(ToolError, match="limit of"):
        asyncio.run(scout(query="DESeq2 lfcShrink apeglm", objective="o"))  # type: ignore[arg-type]
    assert sent["calls"] == tools.MAX_SEARCHES
    assert ledger.events[-1]["kind"] == "search.refused"


def test_the_search_cap_holds_for_parallel_and_failed_calls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = {"n": 0}

    async def slow_and_failing(query: str, objective: str, key: str) -> dict[str, Any]:
        calls["n"] += 1
        mine = calls["n"]
        await asyncio.sleep(0.01)  # every parallel call is past the cap check before one ends
        if mine % 2:
            raise ToolError("search failed (500): upstream")
        return {"results": [{"url": "https://www.htslib.org/doc/samtools.html", "title": "t"}]}

    async def no_save(_: Ledger) -> None: ...

    monkeypatch.setattr(tools, "exa_docs", slow_and_failing)
    monkeypatch.setattr(tools, "save_ledger", no_save)
    monkeypatch.setenv("EXA_API_KEY", "test-key")
    ledger = Ledger()
    search = tools.search_docs(ledger, "scout")

    async def burst() -> list[object]:
        jobs = [
            search(query="samtools sort", objective="o") for _ in range(tools.MAX_SEARCHES + 15)
        ]  # type: ignore[arg-type]
        return await asyncio.gather(*jobs, return_exceptions=True)

    results = asyncio.run(burst())
    assert calls["n"] == tools.MAX_SEARCHES  # not one call more reached the search engine
    refused = [r for r in results if isinstance(r, ToolError) and "limit of" in str(r)]
    assert len(refused) == 15
    done = [e for e in ledger.events if e["kind"] == "search"]
    assert len(done) == tools.MAX_SEARCHES  # failed calls are counted and logged
    assert sum(1 for e in done if e.get("failed")) == tools.MAX_SEARCHES // 2
    with pytest.raises(ToolError, match="limit of"):
        asyncio.run(search(query="samtools sort", objective="o"))  # type: ignore[arg-type]
    assert calls["n"] == tools.MAX_SEARCHES


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
    assert calls[0][1]["label"] == "GLHF swarm lessons, task 9"
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


def test_past_dev_recall_respects_the_context_of_a_lesson(monkeypatch: pytest.MonkeyPatch) -> None:
    from bixbench3.inspect_harness.swarm import past_memory

    calls: list[dict[str, Any]] = []

    class Reply:
        def raise_for_status(self) -> None: ...
        def json(self) -> dict[str, Any]:
            return {
                "ingestionId": "abc",
                "results": [
                    {  # written by a run on task 11 that had read task 9's lessons
                        "content": "compare the sheet with the data before planning",
                        "sources": [
                            {
                                "sourceId": "glhf-lessons-11-20260101T000000Z",
                                "label": "GLHF swarm lessons, task 11; context: task 9, task 16",
                            }
                        ],
                    },
                    {
                        "content": "index alignments first",
                        "sources": [{"sourceId": "glhf-lessons-demo-x-20260101T000000Z"}],
                    },
                ],
            }

    class Client:
        def __init__(self, **_: object) -> None: ...
        async def __aenter__(self) -> Client:
            return self

        async def __aexit__(self, *_: object) -> None: ...
        async def post(self, url: str, *, headers: dict[str, str], json: dict[str, Any]) -> Reply:
            calls.append(json)
            return Reply()

    monkeypatch.setenv("PAST_API_KEY", "test-key")
    monkeypatch.setattr(past_memory.httpx, "AsyncClient", Client)
    asyncio.run(past_memory.remember("11", "- compare the sheet", ["9", "16"]))
    assert calls[0]["label"] == "GLHF swarm lessons, task 11; context: task 9, task 16"
    # Task 9 does not get the lesson a run on 11 wrote after reading task 9's lessons.
    text, sources = asyncio.run(past_memory.recall_with_sources(task_id="9"))
    assert text == "index alignments first" and sources == {"demo-x"}
    text, sources = asyncio.run(past_memory.recall_with_sources(task_id="4"))
    assert "compare the sheet" in text and sources == {"11", "9", "16", "demo-x"}
