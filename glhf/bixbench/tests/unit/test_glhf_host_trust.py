"""What the host trusts of a run, and what it does not (security review of 2026-11-14).

Two attacks were reproduced from inside the sandbox and are replayed here without Docker:
  H1  /outputs/<artifact> created as a symbolic link to the grader's own truth file (the host
      path is readable in /proc/self/mountinfo); the host grader followed it: score 1.0.
  H2  a background loop left by the reporter rewrote /outputs/glhf/ledger.json, and the host
      took "verdict: supported, e_value: 500" for a claim that had no test.
Also here: the scripted run can never reach Exa, the scripted model is keyed by role, the
ledger's sandbox copy and the shape check have time limits, and smaller findings of the review.
No network, no Docker, no model.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import anyio
import pytest
from inspect_ai.model import ChatMessageSystem, ChatMessageUser, GenerateConfig
from inspect_ai.tool import ToolInfo

from bixbench3 import glhf_local
from bixbench3.inspect_harness import tasks
from bixbench3.inspect_harness.models import ExpectedOutput
from bixbench3.inspect_harness.swarm import memory, roles, tools
from bixbench3.inspect_harness.swarm.ledger import Ledger

DEMO_CASE = Path(__file__).parents[3] / "demo_case"


# ------------------------------------------------------------------------- H1: collect_outputs
def test_only_plain_files_are_copied_out_of_the_outputs_folder(tmp_path: Path) -> None:
    secret = tmp_path / "grader" / "truth.csv"
    secret.parent.mkdir()
    secret.write_text("gene_id,count\ng1,7\n")
    outputs = tmp_path / "outputs"
    (outputs / "glhf" / "scripts").mkdir(parents=True)
    (outputs / "ok.csv").write_text("gene_id,count\ng1,1\n")
    (outputs / "glhf" / "scripts" / "run.py").write_text("print(1)\n")
    (outputs / "link.csv").symlink_to(secret)  # the attack
    (outputs / "dangling.csv").symlink_to(tmp_path / "nowhere")
    (outputs / "folder_link").symlink_to(secret.parent, target_is_directory=True)
    os.link(secret, outputs / "hard.csv")  # a second name for the truth file
    os.mkfifo(outputs / "pipe")  # would block a reader for ever
    (outputs / "big.bin").write_bytes(b"x" * 2000)

    target = tmp_path / "graded"
    refused = glhf_local.collect_outputs(outputs, target, max_file_bytes=1000)
    reasons = {r["path"]: r["reason"] for r in refused}
    assert set(reasons) == {
        "link.csv",
        "dangling.csv",
        "folder_link",
        "hard.csv",
        "pipe",
        "big.bin",
    }
    assert reasons["link.csv"] == reasons["folder_link"] == "symbolic link"
    assert "hard link" in reasons["hard.csv"] and "not a regular file" in reasons["pipe"]
    assert "larger than 1000 bytes" in reasons["big.bin"]
    copied = sorted(str(p.relative_to(target)) for p in target.rglob("*") if p.is_file())
    assert copied == ["glhf/scripts/run.py", "ok.csv"]
    assert not any(p.is_symlink() for p in target.rglob("*"))
    assert "g1,7" not in "".join(p.read_text() for p in target.rglob("*") if p.is_file())


def test_the_copy_has_a_total_size_cap_and_needs_a_fresh_folder(tmp_path: Path) -> None:
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    for name in ("a", "b", "c"):
        (outputs / name).write_bytes(b"x" * 400)
    refused = glhf_local.collect_outputs(outputs, tmp_path / "graded", max_total_bytes=1000)
    assert [r["path"] for r in refused] == ["c"] and "in total" in refused[0]["reason"]
    with pytest.raises(glhf_local.UnsafeOutputs, match="fresh"):
        glhf_local.collect_outputs(outputs, tmp_path / "graded")
    # The outputs folder itself replaced by a link: nothing is read through it.
    (tmp_path / "elsewhere").mkdir()
    (tmp_path / "elsewhere" / "x.csv").write_text("a\n")
    (tmp_path / "linked").symlink_to(tmp_path / "elsewhere", target_is_directory=True)
    refused = glhf_local.collect_outputs(tmp_path / "linked", tmp_path / "graded2")
    assert refused and not (tmp_path / "graded2" / "x.csv").exists()


# ------------------------------------------------------------- H1 and H2: a whole run, replayed
def _case(tmp_path: Path) -> Path:
    case = tmp_path / "case"
    shutil.copytree(DEMO_CASE, case)
    return case


def _real_ledger() -> Ledger:
    ledger = Ledger()
    ledger.add_claim("The first pass is complete.", ["gene_counts"], "It is not.", "planner")
    ledger.log("settings", memory_source=None)
    return ledger


def _replay(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    sandbox_did: Any,
    ledger: Ledger | None = None,
    **settings: Any,
) -> dict[str, Any]:
    """run_local with the Inspect run replaced by `sandbox_did(case, outputs)`: what the agents
    left in the outputs folder. The solver process's ledger is what a real run keeps in the
    sample's store."""
    case, out = _case(tmp_path), tmp_path / "run"
    kept = ledger or _real_ledger()

    def fake_eval(task: object, **_: object) -> list[Any]:
        outputs = Path(os.environ["BIXBENCH3_OUTPUTS_DIR"])
        assert os.environ[tools.HOST_LEDGER_ENV] == str(out.resolve())
        sandbox_did(case, outputs)
        sample = SimpleNamespace(
            store={
                tools.LEDGER_STORE_KEY: kept.to_json(),
                tools.FINDINGS_STORE_KEY: kept.findings_markdown(),
            },
            metadata={},
            messages=[],
        )
        return [
            SimpleNamespace(
                status="success",
                error=None,
                samples=[sample],
                stats=SimpleNamespace(model_usage={}),
            )
        ]

    monkeypatch.setattr(glhf_local, "inspect_eval", fake_eval)
    summary = glhf_local.run_local(case, out, solver="glhf", model="mock", **settings)
    assert json.loads((out / "run.json").read_text()) == summary
    return summary


def _honest(case: Path, outputs: Path) -> None:
    for truth in (case / "grader" / "artifacts").iterdir():
        (outputs / truth.name).write_text(truth.read_text())
    (outputs / "METHODS.md").write_text("# Methods\n")


def test_an_honest_run_is_graded_from_the_copy_the_sandbox_never_saw(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    summary = _replay(monkeypatch, tmp_path, _honest)
    assert summary["status"] == "done" and summary["score"] == 1.0
    assert summary["outputs_rejected"] == [] and summary["graded_outputs"] == "graded"
    graded = tmp_path / "run" / "graded"
    assert sorted(p.name for p in graded.iterdir()) == [
        "METHODS.md",
        "gene_counts.csv",
        "treated_vs_control.csv",
    ]
    assert not graded.is_relative_to(tmp_path / "run" / "outputs")
    assert not graded.is_relative_to(tmp_path / "run" / "workspace")


def test_outputs_that_are_links_to_the_grader_s_truth_score_nothing_H1(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def attack(case: Path, outputs: Path) -> None:
        # No analysis: each required output is a link to the file it will be compared with.
        for truth in (case / "grader" / "artifacts").iterdir():
            (outputs / truth.name).symlink_to(truth.resolve())
        (outputs / "METHODS.md").write_text("# Methods\n")

    summary = _replay(monkeypatch, tmp_path, attack)
    assert summary["status"] == "failed" and summary["score"] is None
    assert summary["artifacts"] == []
    assert sorted(r["path"] for r in summary["outputs_rejected"]) == [
        "gene_counts.csv",
        "treated_vs_control.csv",
    ]
    assert "outputs rejected, nothing was graded" in summary["error"]
    assert "symbolic link" in summary["error"]
    out = tmp_path / "run"
    grade = json.loads((out / "grade.json").read_text())
    assert grade["score"] is None and len(grade["outputs_rejected"]) == 2
    assert not (out / "graded" / "gene_counts.csv").exists()
    # The marker is in the ledger the host keeps, too.
    events = json.loads((out / "ledger.json").read_text())["events"]
    assert events[-1]["kind"] == "outputs.rejected" and events[-1]["count"] == 2


def test_one_bad_entry_anywhere_under_outputs_fails_the_run(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def mostly_honest(case: Path, outputs: Path) -> None:
        _honest(case, outputs)
        (outputs / "glhf").mkdir()
        (outputs / "glhf" / "notes").symlink_to(case / "grader", target_is_directory=True)

    summary = _replay(monkeypatch, tmp_path, mostly_honest)
    assert summary["status"] == "failed" and summary["score"] is None
    assert summary["outputs_rejected"] == [{"path": "glhf/notes", "reason": "symbolic link"}]


def test_the_grader_s_folder_is_never_inside_what_the_sandbox_mounts(tmp_path: Path) -> None:
    case = _case(tmp_path)
    shutil.move(str(case / "grader"), str(case / "data" / "grader"))
    (case / "grader").symlink_to(case / "data" / "grader", target_is_directory=True)
    with pytest.raises(ValueError, match="grader's files inside the sandbox"):
        glhf_local.run_local(case, tmp_path / "run", solver="glhf", model="mock")
    compose = glhf_local.LOCAL_COMPOSE.read_text()
    assert "${BIXBENCH3_DATA_DIR" in compose and ":/data:ro" in compose
    assert "grader" not in compose.split("volumes:")[1]


def test_the_host_s_ledger_is_the_solver_s_not_the_one_the_sandbox_wrote_H2(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def forged(case: Path, outputs: Path) -> None:
        _honest(case, outputs)
        (outputs / "glhf").mkdir()
        fake = json.loads(_real_ledger().to_json())
        fake["claims"][0].update(verdict="supported", e_value=500)
        (outputs / "glhf" / "ledger.json").write_text(json.dumps(fake))
        (outputs / "glhf" / "FINDINGS.md").write_text("## Supported findings (1)\n\nC1 e = 500\n")

    summary = _replay(monkeypatch, tmp_path, forged)
    out = tmp_path / "run"
    assert summary["ledger"] == "ledger.json" and summary["findings"] == "FINDINGS.md"
    assert summary["claims"] == [
        {
            "id": "C1",
            "text": "The first pass is complete.",
            "verdict": "untested",
            "e_value": 1.0,
            "threshold": 10.0,
        }
    ]
    assert summary["sandbox_ledger_differs"] is True
    kept = json.loads((out / "ledger.json").read_text())
    assert kept == json.loads(_real_ledger().to_json())
    assert "## Supported findings (0)" in (out / "FINDINGS.md").read_text()
    assert "500" not in (out / "FINDINGS.md").read_text()
    # What the sandbox wrote is kept in the copy under a name that says what it is.
    assert sorted(p.name for p in (out / "graded" / "glhf").iterdir()) == [
        "FINDINGS.sandbox-copy-untrusted.md",
        "ledger.sandbox-copy-untrusted.json",
    ]


def test_an_untouched_sandbox_copy_is_reported_as_the_same(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def copied(case: Path, outputs: Path) -> None:
        _honest(case, outputs)
        (outputs / "glhf").mkdir()
        (outputs / "glhf" / "ledger.json").write_text(_real_ledger().to_json())

    assert _replay(monkeypatch, tmp_path, copied)["sandbox_ledger_differs"] is False


def test_an_unreviewed_run_is_marked_in_run_json(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    ledger = _real_ledger()
    ledger.log("review.none", rounds_planned=3)
    summary = _replay(monkeypatch, tmp_path, _honest, ledger)
    assert summary["unreviewed"] is True
    assert "## NOT REVIEWED" in (tmp_path / "run" / "FINDINGS.md").read_text()
    assert "unreviewed" not in _replay(monkeypatch, tmp_path / "again", _honest)


# ------------------------------------------------------------------ H2: where the ledger is kept
def test_the_ledger_is_kept_in_the_store_and_on_the_host_from_memory(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    kept: dict[str, Any] = {}
    monkeypatch.setattr(tools, "store", lambda: SimpleNamespace(set=kept.__setitem__))
    monkeypatch.setenv(tools.HOST_LEDGER_ENV, str(tmp_path / "run"))
    ledger = _real_ledger()
    tools.persist_ledger(ledger)
    assert kept == {
        tools.LEDGER_STORE_KEY: ledger.to_json(),
        tools.FINDINGS_STORE_KEY: ledger.findings_markdown(),
    }
    assert (tmp_path / "run" / "ledger.json").read_text() == ledger.to_json()
    assert (tmp_path / "run" / "FINDINGS.md").read_text() == ledger.findings_markdown()
    assert [p.name for p in (tmp_path / "run").iterdir() if p.name.startswith(".")] == []
    monkeypatch.delenv(tools.HOST_LEDGER_ENV)
    kept.clear()
    tools.persist_ledger(ledger)  # no host folder (a cloud run): the store alone
    assert set(kept) == {tools.LEDGER_STORE_KEY, tools.FINDINGS_STORE_KEY}


def test_saving_keeps_the_trusted_copy_first_and_a_stuck_sandbox_cannot_hold_the_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    kept: list[str] = []
    seen: list[dict[str, Any]] = []

    class Box:
        async def exec(self, cmd: list[str], **options: Any) -> SimpleNamespace:
            seen.append(options)
            assert kept, "the trusted copy must be kept before the sandbox is touched"
            return SimpleNamespace(success=True, stdout="", stderr="")

        async def write_file(self, path: str, text: str) -> None:
            await anyio.sleep(30)  # a sandbox that does not answer

    monkeypatch.setattr(tools, "persist_ledger", lambda ledger: kept.append(ledger.to_json()))
    monkeypatch.setattr(tools, "sandbox", lambda: Box())
    monkeypatch.setattr(tools, "SAVE_TIMEOUT", 0.05)
    ledger = _real_ledger()

    async def save() -> None:
        with anyio.fail_after(5):  # the test's own limit: without the fix this is what ends it
            await tools.save_ledger(ledger)

    asyncio.run(save())
    assert seen[0]["timeout"] == 0.05
    assert [e["kind"] for e in ledger.events].count("ledger.sandbox_copy_timeout") == 1
    assert len(kept) == 2 and "ledger.sandbox_copy_timeout" in kept[-1]
    asyncio.run(save())  # said once, not at every save
    assert [e["kind"] for e in ledger.events].count("ledger.sandbox_copy_timeout") == 1


def test_the_shape_check_has_a_short_time_limit_and_a_timeout_is_a_failed_check(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[Any] = []

    class Box:
        async def exec(self, cmd: list[str], **options: Any) -> SimpleNamespace:
            seen.append(options.get("timeout"))
            raise TimeoutError

    monkeypatch.setattr(tools, "sandbox", lambda: Box())
    outputs = [ExpectedOutput(artifact_id="degs", path="degs.csv", format="csv")]
    report = asyncio.run(tools.check_contract(outputs))
    assert seen == [tools.CONTRACT_TIMEOUT] and tools.CONTRACT_TIMEOUT <= 120
    assert tools.check_failed(report) and tools.needs_rescue(report) == []
    assert "no answer from the sandbox" in tools.contract_text(report)


# ------------------------------------------------------------------------- the scripted model
def test_a_scripted_run_cannot_reach_exa_even_with_a_key(monkeypatch: pytest.MonkeyPatch) -> None:
    def no_network(*_: object, **__: object) -> None:
        raise AssertionError("a scripted run opened a network client")

    monkeypatch.setattr(tools.httpx, "AsyncClient", no_network)
    monkeypatch.setenv("EXA_API_KEY", "a-real-key")
    real = tools.exa_docs
    with glhf_local.offline_search():
        assert os.environ["EXA_API_KEY"] != "a-real-key"  # the real key is out of reach
        assert asyncio.run(tools.exa_docs("q", "o", "a-real-key")) == {"results": []}
    assert tools.exa_docs is real and os.environ["EXA_API_KEY"] == "a-real-key"
    monkeypatch.delenv("EXA_API_KEY")
    with pytest.raises(RuntimeError), glhf_local.offline_search():
        raise RuntimeError("the run failed")
    assert tools.exa_docs is real and "EXA_API_KEY" not in os.environ


def test_run_local_wraps_a_scripted_run_in_the_offline_search_and_no_other(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("EXA_API_KEY", "a-real-key")
    monkeypatch.setenv("NO_PAID_CALLS", "0")
    during: list[tuple[str, bool]] = []
    real = tools.exa_docs

    def look(case: Path, outputs: Path) -> None:
        during.append((os.environ["EXA_API_KEY"], tools.exa_docs is real))
        _honest(case, outputs)

    _replay(monkeypatch, tmp_path, look, exa=True)
    assert during == [("scripted-run-no-key", False)]
    assert os.environ["EXA_API_KEY"] == "a-real-key" and tools.exa_docs is real


def _call_of(role_prompt: str, *, tools_given: bool = True) -> Any:
    messages = [
        ChatMessageSystem(content=f"{role_prompt}\n\nYou may submit when done."),
        ChatMessageUser(content="BRIEF"),
    ]
    given = [ToolInfo(name="python", description="run python")] if tools_given else []
    return messages, given, "auto", GenerateConfig()


def test_the_scripted_model_answers_by_role_not_by_position() -> None:
    truths = {"/outputs/a.csv": "id,x\n1,2\n", "/outputs/b.csv": "id,y\n1,3\n"}
    script = glhf_local.role_script(truths)
    assert set(script) == {
        "scout",
        "planner",
        "pilot",
        "experimenter",
        "auditor",
        "critic",
        "reviser",
        "finisher",
        "reporter",
    }
    answer = glhf_local.by_role(script)

    def tool_of(output: Any) -> str:
        return str(output.message.tool_calls[0].function)

    # The scout was cut off before its first line and the planner was skipped: the critic,
    # called first, still gets the critic's lines, and the reporter the reporter's.
    assert tool_of(answer(*_call_of(roles.CRITIC))) == "raise_issue"
    reporter = answer(*_call_of(roles.REPORTER + roles.LESSONS))
    assert "METHODS.md" in str(reporter.message.tool_calls[0].arguments)
    assert tool_of(answer(*_call_of(roles.SCOUT + roles.SEARCH))) == "bash_session"
    # Instructions that extend the experimenter's are told apart from it.
    for prompt, name in (
        (roles.PILOT, "pilot"),
        (roles.REVISER, "reviser"),
        (roles.FINISHER, "finisher"),
        (roles.EXPERIMENTER, "experimenter"),
    ):
        assert glhf_local.role_of(_call_of(prompt)[0]) == name
    # A role with nothing left submits; it does not take another role's line.
    assert tool_of(answer(*_call_of(roles.PILOT))) == "submit"
    again = answer(*_call_of(roles.PILOT))
    assert tool_of(again) == "submit" and "nothing left" in str(again.message.tool_calls[0])
    assert script["planner"] and len(glhf_local.by_role(script).__closure__ or ()) > 0
    # The forced final turn of a role that hit a limit has no tools: a note, not a tool call.
    note = answer(*_call_of(roles.HANDOFF, tools_given=False))
    assert not note.message.tool_calls and "hand-off" in note.completion


def test_the_flat_script_is_the_role_script_in_play_order() -> None:
    truths = {"/outputs/a.csv": "id,x\n1,2\n"}
    flat = glhf_local.mock_script("glhf", truths, review_rounds=0, memory=True)
    by_role = glhf_local.role_script(truths, review_rounds=0, memory=True)
    assert len(flat) == sum(len(lines) for lines in by_role.values())
    single = glhf_local.mock_script("single", truths)
    assert [o.message.tool_calls[0].function for o in single] == ["python", "python", "submit"]  # type: ignore[index]


# ------------------------------------------------------------------------- smaller findings
def test_a_recorded_test_does_not_claim_a_verdict_that_can_go_stale() -> None:
    ledger = Ledger()
    claim = ledger.add_claim("effect present", ["degs"], "effect absent", "planner")
    ledger.register_test(claim.id, "perm", "permute labels", "critic")
    ledger.record_test(claim.id, "perm", 0.0025, False, "", "critic")
    event = ledger.events[-1]
    assert event["kind"] == "test.recorded" and "verdict" not in event
    assert event["verdict_at_the_time"] == "supported"
    # A second claim raises the threshold for every claim: the first is no longer supported,
    # and the event never said it "is".
    ledger.add_claim("another effect", ["degs"], "no effect", "planner")
    assert claim.verdict == "insufficient"
    assert json.loads(ledger.to_json())["claims"][0]["verdict"] == "insufficient"


def test_the_sample_s_hard_token_limit_is_a_close_backstop() -> None:
    assert tasks.TOKEN_BACKSTOP == 1.15
    limited = tasks.bixbench3_cases(str(DEMO_CASE), solver="glhf", max_tokens=100_000)
    assert limited.token_limit == 115_000
    assert tasks.bixbench3_cases(str(DEMO_CASE), solver="glhf").token_limit is None


def test_approve_all_needs_the_person_to_say_the_lessons_were_read(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    folder = str(tmp_path)
    memory.add_pending(folder, "9", "- pin the annotation version\n")
    assert memory.main(["--dir", folder, "--no-past", "approve-all"]) == 2
    assert "--i-read-them" in capsys.readouterr().err
    assert len(memory.pending_lessons(folder)) == 1 and memory.read_memory(folder, "10") == ""
    assert memory.main(["--dir", folder, "--no-past", "approve-all", "--i-read-them"]) == 0
    assert memory.read_memory(folder, "10") == "- pin the annotation version"
    # reject-all destroys nothing a later run could see, and approving by number names each
    # lesson: neither needs the flag.
    memory.add_pending(folder, "9", "- sort by name\n")
    assert memory.main(["--dir", folder, "--no-past", "approve", "1"]) == 0


@pytest.mark.parametrize(
    "url",
    [
        "https://support.10xgenomics.com/single-cell-gene-expression/datasets",
        "https://support.10xgenomics.com/single-cell-gene-expression/datasets/3.0.0/pbmc_10k_v3",
        "https://support.10xgenomics.com/spatial-gene-expression/datasets/1.1.0/V1_Human_Brain",
        "https://support.10xgenomics.com/single-cell-gene-expression/software/datasets/x",
        "https://support.10xgenomics.com/",
        "https://support.10xgenomics.com/single-cell-gene-expression/index",
        "https://cf.support.10xgenomics.com/single-cell-gene-expression/software/overview",
    ],
)
def test_10x_dataset_pages_are_not_documentation(url: str) -> None:
    # The allow-list may hold no data repository, and this host serves 10x's public datasets
    # next to its manuals.
    assert tools.result_block_reason(url) is not None


@pytest.mark.parametrize(
    "url",
    [
        "https://support.10xgenomics.com/single-cell-gene-expression/software/pipelines/latest/using/count",
        "https://support.10xgenomics.com/single-cell-atac/software/pipelines/latest/algorithms/overview",
        "https://support.10xgenomics.com/docs/bamtofastq",
    ],
)
def test_10x_software_documentation_is_still_allowed(url: str) -> None:
    assert tools.result_block_reason(url) is None


def test_satijalab_dataset_tutorials_still_pass_and_are_reported_not_removed() -> None:
    # Known and open (a decision for the user, like hbctraining.github.io and the Galaxy
    # training site): Seurat's vignettes are worked analyses of named public datasets.
    assert "satijalab.org" in tools.DOC_DOMAINS
    assert (
        tools.result_block_reason("https://satijalab.org/seurat/articles/pbmc3k_tutorial") is None
    )
    # What is closed for every host: the data files next to the tutorials.
    assert tools.result_block_reason("https://satijalab.org/seurat/data/pbmc3k_final.rds")


def test_a_query_may_not_point_at_a_paper_s_code_but_a_manual_may_say_github() -> None:
    assert "points at a paper" in str(tools.query_refusal("the github repository of the paper"))
    assert tools.query_refusal("supplementary table 2 of the knockdown") is not None
    # The same words in the text of a result are documentation, not a lookup.
    assert (
        tools.query_refusal("Install from GitHub with remotes::install_github", places=False)
        is None
    )
    assert tools.query_refusal("Install from GitHub with remotes", places=True) is not None
