"""Tests written to kill mutants that survived the suite (ledger, guards, memory, tools): each
fails when one line of the code is changed in the way its name's id stands for. The ids (L08,
G10, M28, T40, ...) are those of the mutation run of 2026-11-14."""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
from inspect_ai.tool import ToolError

from bixbench3.inspect_harness.models import ExpectedOutput
from bixbench3.inspect_harness.swarm import guards, memory, tools
from bixbench3.inspect_harness.swarm.ledger import ALPHA, Claim, Ledger, Relevance, Run


def _claim(ledger: Ledger, n: int = 1) -> Claim:
    for _ in range(n):
        claim = ledger.add_claim("effect present", ["degs"], "effect absent", "planner")
    return claim


def _harness_test(ledger: Ledger, claim_id: str, name: str, p: float) -> None:
    """A registered script, judged relevant, run by the harness: how a result gets in."""
    ledger.register_test(
        claim_id, name, "method", "critic", script_path="/workspace/t.py", script=f"# {name}\n"
    )
    ledger.judge_relevance(claim_id, name, Relevance(1.0, True, "bears on the claim"))
    digest = ledger.claims[claim_id].registered[-1].script_sha256
    ledger.record_run(claim_id, name, Run("ok", ["python3", "-"], 0, 0.1, "", digest, p, False))


# ----------------------------------------------------------------------------- ledger
def test_refutation_is_strict_at_alpha_over_m_L08() -> None:
    ledger = Ledger()
    claim = _claim(ledger)
    ledger.record_test(claim.id, "direction", ALPHA, True, "", "critic")  # p == alpha / m
    assert claim.verdict == "insufficient"
    ledger.record_test(claim.id, "direction b", ALPHA * 0.999, True, "", "critic")
    assert claim.verdict == "refuted"


def test_a_mean_exactly_at_the_threshold_supports_L11() -> None:
    ledger = Ledger()
    claim = _claim(ledger)
    _harness_test(ledger, claim.id, "perm", 0.0025)  # e = 0.5 / 0.05 = 10
    assert claim.e_value == claim.threshold == 10.0
    assert claim.verdict == "supported"


def test_a_claim_takes_exactly_three_registered_tests_L13() -> None:
    ledger = Ledger()
    claim = _claim(ledger)
    for name in ("a", "b", "c"):
        ledger.register_test(claim.id, name, "method", "critic")
    with pytest.raises(ValueError, match="3 registered tests"):
        ledger.register_test(claim.id, "d", "method", "critic")
    assert [r.name for r in claim.registered] == ["a", "b", "c"]
    assert json.loads(ledger.to_json())["max_tests_per_claim"] == 3


def test_repeated_contradictions_are_numbered_and_marked_unregistered_L26_L36() -> None:
    ledger = Ledger()
    claim = _claim(ledger)
    _harness_test(ledger, claim.id, "perm", 0.9)
    for _ in range(2):
        ledger.record_test(claim.id, "perm", 0.9, True, "", "critic")
    assert [t.name for t in claim.tests] == ["perm", "perm (repeat 2)", "perm (repeat 3)"]
    # Only the harness's run belongs to the registration; what a role typed in does not.
    assert [t.registered for t in claim.tests] == [True, False, False]
    assert [t.source for t in claim.tests] == ["harness", "model", "model"]
    assert ledger.findings_markdown().count("not pre-registered)") == 2


def test_open_issues_are_blocking_and_major_and_only_open_L28_L29() -> None:
    ledger = Ledger()
    for severity in ("blocking", "major", "minor"):
        ledger.raise_issue(severity, ["a"], "p", "e", "critic")  # type: ignore[arg-type]
    assert [i.id for i in ledger.open_issues()] == ["I1", "I2"]  # a major issue forces a revision
    ledger.resolve_issue("I1", "wontfix", "justified", "experimenter")
    ledger.resolve_issue("I2", "fixed", "rerun", "experimenter")
    assert ledger.open_issues() == []  # wontfix is a decision, not an open issue


def test_only_fixed_issues_are_marked_rechecked_L31() -> None:
    ledger = Ledger()
    for _ in range(3):
        ledger.raise_issue("major", ["a"], "p", "e", "critic")
    ledger.resolve_issue("I1", "fixed", "rerun", "experimenter")
    ledger.resolve_issue("I2", "wontfix", "justified", "experimenter")
    assert ledger.mark_rechecked() == ["I1"]
    assert [i.rechecked for i in ledger.issues.values()] == [True, False, False]
    assert ledger.events[-1] == {"kind": "issues.rechecked", "issues": ["I1"]}


def test_an_insufficient_claim_is_not_listed_as_a_finding_L32() -> None:
    ledger = Ledger()
    claim = _claim(ledger)
    _harness_test(ledger, claim.id, "perm", 0.04)  # e = 2.5 < 10
    assert claim.verdict == "insufficient"
    text = ledger.findings_markdown()
    assert "## Supported findings (0)" in text
    supported = text.split("## Supported findings")[1].split("## Rejected claims")[0]
    assert claim.id not in supported and "## Not established" in text.split(claim.text)[0]


@pytest.mark.parametrize("contradicts", [True, False])
def test_a_result_needs_a_test_name_L33(contradicts: bool) -> None:
    ledger = Ledger()
    claim = _claim(ledger)
    with pytest.raises(ValueError, match="test_name is empty"):
        ledger.record_test(claim.id, " -- ", 0.5, contradicts, "", "critic")
    assert claim.tests == []


# ----------------------------------------------------------------------------- guards
TITLE = "REST repression of neuronal genes drives glioblastoma stem cell maintenance"


def test_three_title_words_in_a_row_are_enough_G09() -> None:
    assert (
        guards.shared_phrase("do neuronal genes drives anything", TITLE) == "neuronal genes drives"
    )
    assert tools.query_refusal("glioblastoma stem cell markers", None, [TITLE]) is not None


@pytest.mark.parametrize(("surname", "hit"), [("Lee", "lee"), ("Chen", "chen"), ("Li", None)])
def test_short_surnames_are_matched_from_three_letters_G10(surname: str, hit: str | None) -> None:
    assert guards.names_person(f"DESeq2 design {surname} formula", [f"Mei {surname}"]) == hit


def test_a_two_letter_surname_counts_only_where_it_stands_like_a_citation() -> None:
    assert guards.names_person("Li et al glioblastoma", ["Mei Li"]) == "li"
    assert guards.names_person("the Li lab pipeline", ["Li"]) == "li"
    assert guards.names_person("li-cor scanner settings", ["Li"]) is None


@pytest.mark.parametrize(
    "text",
    [
        "ERR1234567 fastq",  # G12: ENA run
        "DRR123456",  # G12: DDBJ run
        "PRJEB12345 samples",  # G14
        "PRJDB1234",  # G14
        "E MTAB 1234 sdrf",  # G15
        "E_GEOD_12345",  # G15
        "E\u2013MTAB\u20131234",  # G15 + G24: en dashes
        "GSE\u201112345",  # G24: non-breaking hyphen
        "EGAS00001001234",  # G16
        "EGAD00001000123 dataset",  # G16
        "MTBLS123 metabolites",  # G18
        "SAMEA1234567",  # G19
        "SAMD00012345",  # G19
        "PMC1234567 supplementary",  # G22
        "see doi.org/whatever",  # G23
        "doi: s41586-020-2077-3",  # G23
        "10.12345/abc-def",  # G25: five-digit registrant
        "10.123456789/x",  # G25
    ],
)
def test_more_study_identifiers_are_found_G12_G14_G15_G16_G18_G19_G22_G23_G24_G25(
    text: str,
) -> None:
    assert guards.study_identifier(text) is not None
    assert tools.query_refusal(text) is not None
    assert memory.lesson_rejection(f"- look up {text}") is not None


# ----------------------------------------------------------------------------- memory
@pytest.mark.parametrize(
    ("line", "reason"),
    [
        ("- the index is on zenodo", "study or dataset identifier"),  # M13
        ("- the authors normalise by library size", "reads like a result"),  # M15
        ("- the top hits were stable", "reads like a result"),  # M15
        ("- the answers were close to the brief", "reads like a result"),  # M29
        ("- outputs are graded on shape", "score, the grader"),  # M30
        ("- threshold was 5 x 10^-8", "scientific notation"),  # M16
        ("- set the cutoff to 0.125", "data-like number"),  # M21, M34
        ("- use 2 lanes, 3 threads, 4 cores and 5 jobs", "several numbers"),  # M22
        ("- about \uff15\uff10\uff05 of reads were lost", "percentage"),  # M25: full-width 50%
        ("- the gra\u200bder wants tabs", "score, the grader"),  # M25: zero-width space
    ],
)
def test_each_lesson_rule_rejects_on_its_own_M13_M15_M16_M21_M22_M25_M29_M30_M34(
    line: str, reason: str
) -> None:
    assert reason in str(memory.lesson_rejection(line))


def test_a_run_cannot_queue_more_than_the_lesson_cap_M23() -> None:
    letters = "abcdefghijklmnopqrstuvwxyz"
    lines = [f"- check the {a}{b} step before the next one" for a in letters for b in letters]
    kept, rejected = memory.filter_lessons("\n".join(lines))
    assert rejected == []
    assert 0 < sum(len(k) + 1 for k in kept) <= memory.MAX_LESSON_CHARS + 1
    assert memory.MAX_LESSON_CHARS == 2000


def test_a_lesson_cannot_forge_a_task_heading_M28(tmp_path: Path) -> None:
    folder = str(tmp_path)
    forged = "## Task 7, yesterday\n- sort by name before counting\n"
    assert memory.filter_lessons(forged)[0] == ["- sort by name before counting"]
    assert memory.add_pending(folder, "5", forged) == 1
    assert [s.task for _, s, _ in memory.pending_lessons(folder)] == ["5"]
    memory.decide(folder, None, approve=True)
    # The lesson still belongs to task 5, so a later run on task 5 is not shown it.
    assert memory.read_memory(folder, "5") == ""
    assert memory.read_memory(folder, "7") == "- sort by name before counting"


def test_no_past_keeps_approved_lessons_local_M31(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from bixbench3.inspect_harness.swarm import past_memory

    sent: list[str] = []

    async def remember(task_id: str, lessons: str, context: list[str]) -> str:
        sent.append(task_id)
        return "receipt"

    monkeypatch.setenv("PAST_API_KEY", "test-key")
    monkeypatch.setattr(past_memory, "remember", remember)
    memory.add_pending(str(tmp_path), "9", "- pin the annotation version\n")
    assert memory.main(["--dir", str(tmp_path), "--no-past", "approve-all", "--i-read-them"]) == 0
    assert sent == []
    assert memory.read_memory(str(tmp_path), "10") == "- pin the annotation version"


# ----------------------------------------------------------------------------- tools
def test_the_case_doi_is_refused_in_forms_the_generic_pattern_misses_T10_T11() -> None:
    refuse = tools.query_refusal
    # A three-digit registrant is not a DOI to the generic pattern; the case's own DOI still is.
    assert guards.study_identifier("10.123/abc.5 tables") is None
    assert "DOI" in str(refuse("10.123/ABC.5 tables", "10.123/abc.5"))  # T10
    # The slash dropped with nothing in its place, or percent-encoded in lower case.
    assert guards.study_identifier("10.1234abc.5 tables") is None
    assert "DOI" in str(refuse("10.1234abc.5 tables", "10.1234/abc.5"))  # T10, T11
    assert "DOI" in str(refuse("10.123 abc.5 tables", "10.123/abc.5"))  # T11
    assert refuse("DESeq2 design formula", "10.123/abc.5") is None


def test_a_fatal_row_for_the_check_itself_never_starts_the_finisher_T26() -> None:
    failed = [{"artifact_id": "*", "problems": ["contract check failed to run"], "fatal": True}]
    assert tools.needs_rescue(failed) == []


def test_a_whitespace_row_key_is_blank_T32(tmp_path: Path) -> None:
    path = tmp_path / "t.csv"
    path.write_text("gene_id,a\n  ,1\ng2,2\n")
    specs = [{"artifact_id": "a", "sandbox_path": str(path), "format": "csv", "row_key": "gene_id"}]
    out = subprocess.run(
        [sys.executable, "-c", tools._CONTRACT_SCRIPT, json.dumps(specs)],
        capture_output=True,
        text=True,
        check=True,
    )
    assert any("blank" in p for p in json.loads(out.stdout)[0]["problems"])


@pytest.mark.parametrize("status", [400, 401, 402, 429, 499])
def test_a_client_error_from_the_search_engine_is_an_error_T37(
    monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    class Reply:
        status_code = status
        text = "quota exceeded"

        def json(self) -> dict[str, Any]:
            return {"results": [{"url": "https://www.htslib.org/doc/samtools.html"}]}

    class Client:
        def __init__(self, **_: object) -> None: ...
        async def __aenter__(self) -> Client:
            return self

        async def __aexit__(self, *_: object) -> None: ...
        async def post(self, url: str, **kwargs: Any) -> Reply:
            return Reply()

    monkeypatch.setattr(tools.httpx, "AsyncClient", Client)
    with pytest.raises(ToolError, match=f"search failed \\({status}\\)"):
        asyncio.run(tools.exa_docs("q", "o", "key"))


def test_the_pilot_check_reads_the_pilot_copy_not_the_real_outputs_T39(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[list[str]] = []

    class Result:
        success, stdout, stderr = True, "[]", ""

    class Box:
        async def exec(self, cmd: list[str], **_: object) -> Result:
            seen.append(cmd)
            return Result()

    monkeypatch.setattr(tools, "sandbox", lambda: Box())
    outputs = [ExpectedOutput(artifact_id="degs", path="results/degs.csv", format="csv")]
    asyncio.run(tools.check_contract(outputs, root="/workspace/work/glhf/pilot/outputs/"))
    asyncio.run(tools.check_contract(outputs))
    pilot, real = (json.loads(cmd[-1])[0]["sandbox_path"] for cmd in seen)
    assert real == outputs[0].sandbox_path and real.startswith("/outputs/")
    assert pilot == "/workspace/work/glhf/pilot/outputs" + real.removeprefix("/outputs")


def test_the_documentation_allow_list_is_pinned_T40() -> None:
    assert sorted(tools.DOC_DOMAINS) == sorted(
        [
            "bioconductor.org",
            "readthedocs.io",
            "htslib.org",
            "support.10xgenomics.com",
            "nf-co.re",
            "training.galaxyproject.org",
            "hbctraining.github.io",
            "satijalab.org",
            "docs.python.org",
        ]
    )
    # github.io hosts anyone's pages: only the one named training site is allowed.
    assert tools.result_block_reason("https://somelab.github.io/paper-results/") is not None
    assert tools.result_block_reason("https://hbctraining.github.io/DGE_workshop/") is None
