"""The two pieces between a critic's registration and a verdict: the harness that runs the
registered script (tools.py) and the relevance judge (relevance.py). No Docker, no model: the
sandbox and the model are fakes. The ledger's rules are in test_glhf_ledger.py; how the solver
orders and budgets these steps is in test_glhf_solver_gates.py."""

from __future__ import annotations

import asyncio
import hashlib
from types import SimpleNamespace
from typing import Any

import pytest
from inspect_ai.tool import ToolError

from bixbench3.inspect_harness.swarm import relevance, roles, tools
from bixbench3.inspect_harness.swarm.ledger import Ledger, Relevance, Run

GOOD = "import random\nrandom.seed(1)\nprint('GLHF_RESULT p_value=0.0004 contradicts=false')\n"
PATH = "/workspace/work/glhf/tests/perm.py"


class Sandbox:
    """Files, and a scripted answer to the one kind of exec the harness makes."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.files: dict[str, str] = {PATH: GOOD}
        self.runs: list[tuple[list[str], dict[str, Any]]] = []
        self.result: Any = SimpleNamespace(
            success=True,
            returncode=0,
            stdout="GLHF_RESULT p_value=0.0004 contradicts=false\n",
            stderr="",
        )
        self.raises: BaseException | None = None
        box = self

        class Box:
            async def read_file(self, path: str) -> str:
                return box.files[path]

            async def write_file(self, path: str, text: str) -> None:
                box.files[path] = text

            async def exec(self, cmd: list[str], **options: Any) -> Any:
                if "input" not in options:
                    return SimpleNamespace(success=True, returncode=0, stdout="", stderr="")
                box.runs.append((cmd, options))
                if box.raises:
                    raise box.raises
                return box.result

        monkeypatch.setattr(tools, "sandbox", lambda: Box())
        monkeypatch.setattr(tools, "persist_ledger", lambda ledger: None)


@pytest.fixture
def sandbox(monkeypatch: pytest.MonkeyPatch) -> Sandbox:
    return Sandbox(monkeypatch)


def _ledger() -> Ledger:
    ledger = Ledger()
    ledger.add_claim("C10 lowers REST targets", ["degs"], "no change in REST targets", "planner")
    return ledger


def _register(ledger: Ledger, **changes: Any) -> str:
    arguments = {
        "claim_id": "C1",
        "test_name": "permutation",
        "method": "permute the condition labels 10000 times; p near 1 contradicts",
        "script_path": PATH,
        "test_null": "the labels do not matter",
        **changes,
    }
    register = tools.register_falsification_test(ledger, "critic")
    return str(asyncio.run(register(**arguments)))  # type: ignore[arg-type]


def _registered(sandbox: Sandbox, path: str = PATH) -> tuple[Ledger, Any]:
    ledger = _ledger()
    sandbox.files.setdefault(path, GOOD)
    _register(ledger, script_path=path)
    return ledger, ledger.claims["C1"].registered[0]


# ------------------------------------------------------------------------------ registration
def test_registering_reads_the_file_and_records_its_path_and_hash(sandbox: Sandbox) -> None:
    ledger = _ledger()
    said = _register(ledger)
    entry = ledger.claims["C1"].registered[0]
    digest = hashlib.sha256(GOOD.encode()).hexdigest()
    assert (entry.script_path, entry.script_sha256, entry.script) == (PATH, digest, GOOD)
    assert entry.test_null == "the labels do not matter" and entry.by == "critic"
    assert digest[:12] in said and "run by the harness" in said
    assert entry.run is None and entry.relevance is None and sandbox.runs == []  # nothing ran


@pytest.mark.parametrize(
    ("path", "why"),
    [
        ("/outputs/perm.py", "under /workspace/"),
        ("/workspace/work/../../etc/passwd.py", "plain absolute path"),
        ("work/glhf/tests/perm.py", "under /workspace/"),
        ("/workspace/work/glhf/tests/perm.ipynb", "must end in one of"),
        ("/workspace/work/glhf/tests/perm", "must end in one of"),
        ("/workspace/work/glhf/tests/not_written.py", "write the script first"),
    ],
)
def test_a_test_must_be_a_script_file_that_exists_in_the_workspace(
    sandbox: Sandbox, path: str, why: str
) -> None:
    ledger = _ledger()
    with pytest.raises(ToolError, match=why):
        _register(ledger, script_path=path)
    assert ledger.claims["C1"].registered == []


def test_registration_errors_reach_the_role_as_tool_errors(sandbox: Sandbox) -> None:
    ledger = _ledger()
    with pytest.raises(ToolError, match="unknown claim"):
        _register(ledger, claim_id="C9")
    _register(ledger)
    with pytest.raises(ToolError, match="already has a registered test"):
        _register(ledger)
    sandbox.files[PATH] = "   \n"
    with pytest.raises(ToolError, match="script is empty"):
        _register(ledger, test_name="second")


def test_a_role_cannot_type_in_a_favourable_result_through_the_tool(sandbox: Sandbox) -> None:
    ledger = _ledger()
    _register(ledger)
    record = tools.record_falsification_test(ledger, "critic")
    arguments = {"claim_id": "C1", "test_name": "permutation", "p_value": 1e-6, "note": "ran it"}
    with pytest.raises(ToolError, match="cannot support"):
        asyncio.run(record(contradicts=False, **arguments))  # type: ignore[arg-type]
    assert ledger.claims["C1"].tests == []
    said = asyncio.run(record(contradicts=True, **arguments))  # type: ignore[arg-type]
    assert "verdict refuted" in str(said)  # against the claim: always accepted
    assert ledger.claims["C1"].tests[0].source == "model"


# ------------------------------------------------------------------------------ the harness's run
def test_the_harness_runs_the_registered_content_and_reads_the_last_line(sandbox: Sandbox) -> None:
    _, entry = _registered(sandbox)
    sandbox.result.stdout = "permuted 10000 times\nGLHF_RESULT p_value=0.0123 contradicts=true\n"
    run = asyncio.run(tools.run_registered_test(entry, 120))
    [(command, options)] = sandbox.runs
    assert command == ["python3", "-"]
    assert options["input"] == GOOD  # the registered content itself is what is executed
    assert options["cwd"] == tools.WORK and options["timeout"] == 120
    assert options["timeout_retry"] is False  # a slow test is not started a second time
    assert (run.status, run.p_value, run.contradicts, run.exit_code) == ("ok", 0.0123, True, 0)
    assert run.command == ["python3", "-"] and run.sha256_at_run == entry.script_sha256
    assert run.output_tail.endswith("contradicts=true\n") and run.seconds >= 0


@pytest.mark.parametrize(
    ("suffix", "command"),
    [
        (".py", ["python3", "-"]),
        (".sh", ["bash", "-s"]),
        (".R", ["Rscript", "-"]),
        (".r", ["Rscript", "-"]),
    ],
)
def test_the_interpreter_is_chosen_by_the_script_s_suffix(
    sandbox: Sandbox, suffix: str, command: list[str]
) -> None:
    _, entry = _registered(sandbox, f"/workspace/work/glhf/tests/t{suffix}")
    assert asyncio.run(tools.run_registered_test(entry, 60)).command == command
    assert sandbox.runs[0][0] == command


def test_a_script_changed_after_registration_is_not_run(sandbox: Sandbox) -> None:
    _, entry = _registered(sandbox)
    sandbox.files[PATH] = GOOD.replace("0.0004", "0.000001")  # reworked after registration
    run = asyncio.run(tools.run_registered_test(entry, 60))
    assert run.status == "changed" and run.p_value is None and sandbox.runs == []
    assert run.sha256_at_run == hashlib.sha256(sandbox.files[PATH].encode()).hexdigest()
    assert run.sha256_at_run != entry.script_sha256


def test_a_script_that_is_gone_is_not_run(sandbox: Sandbox) -> None:
    _, entry = _registered(sandbox)
    del sandbox.files[PATH]
    run = asyncio.run(tools.run_registered_test(entry, 60))
    assert run.status == "missing" and sandbox.runs == []


def test_a_failing_script_has_no_result_even_if_it_printed_one(sandbox: Sandbox) -> None:
    _, entry = _registered(sandbox)
    sandbox.result = SimpleNamespace(
        success=False,
        returncode=1,
        stdout="GLHF_RESULT p_value=0.000001 contradicts=false\n",
        stderr="Traceback (most recent call last):\nKeyError: 'condition'\n",
    )
    run = asyncio.run(tools.run_registered_test(entry, 60))
    assert (run.status, run.exit_code, run.p_value) == ("failed", 1, None)
    assert "KeyError: 'condition'" in run.output_tail and "[stderr]" in run.output_tail


def test_a_script_that_runs_out_of_time_has_no_result(sandbox: Sandbox) -> None:
    _, entry = _registered(sandbox)
    sandbox.raises = TimeoutError()
    run = asyncio.run(tools.run_registered_test(entry, 30))
    assert (run.status, run.p_value, run.exit_code) == ("timeout", None, None)
    assert "30 s" in run.detail
    sandbox.raises = RuntimeError("output limit exceeded")  # any other failure of the run
    again = asyncio.run(tools.run_registered_test(entry, 30))
    assert again.status == "failed" and "output limit" in again.detail


@pytest.mark.parametrize(
    "stdout",
    [
        "",
        "p = 0.0004\n",
        "GLHF_RESULT p_value=0.0004 contradicts=false\nall done\n",
        "GLHF_RESULT p_value=2 contradicts=false\n",
        "GLHF_RESULT p_value=small contradicts=false\n",
    ],
)
def test_output_without_the_result_line_last_has_no_result(sandbox: Sandbox, stdout: str) -> None:
    _, entry = _registered(sandbox)
    sandbox.result.stdout = stdout
    run = asyncio.run(tools.run_registered_test(entry, 60))
    assert run.status == "unparsable" and run.p_value is None and run.exit_code == 0


def test_what_the_harness_saw_goes_into_the_ledger_and_decides_the_verdict(
    sandbox: Sandbox,
) -> None:
    ledger, entry = _registered(sandbox)
    ledger.judge_relevance("C1", "permutation", Relevance(1.0, True, "bears on the claim"))
    ledger.record_run("C1", "permutation", asyncio.run(tools.run_registered_test(entry, 60)))
    claim = ledger.claims["C1"]
    assert claim.verdict == "supported" and claim.tests[0].p_value == 0.0004
    # The same script, reworked after registration: no result, no support.
    other, changed = _registered(sandbox)
    other.judge_relevance("C1", "permutation", Relevance(1.0, True, "bears on the claim"))
    sandbox.files[PATH] = GOOD + "# tuned\n"
    other.record_run("C1", "permutation", asyncio.run(tools.run_registered_test(changed, 60)))
    assert other.claims["C1"].verdict == "untested" and other.claims["C1"].pending == [
        "permutation"
    ]
    assert other.events[-1]["kind"] == "test.executed" and other.events[-1]["status"] == "changed"


# ------------------------------------------------------------------------------ the relevance judge
def _two_claims() -> Ledger:
    """C1 has a test with a result; C2 has a registered test waiting for a judgement."""
    ledger = _ledger()
    ledger.register_test(
        "C1", "permutation", "permute labels", "critic", script_path=PATH, script=GOOD
    )
    ledger.judge_relevance("C1", "permutation", Relevance(1.0, True, "REASON-OF-ANOTHER-TEST"))
    digest = ledger.claims["C1"].registered[0].script_sha256
    ledger.record_run(
        "C1",
        "permutation",
        Run("ok", ["python3", "-"], 0, 1.0, "OUTPUT-TAIL 0.0004", digest, 0.0004, False),
    )
    ledger.record_test("C1", "direction", 0.031, True, "NOTE-FROM-THE-CRITIC", "critic")
    ledger.raise_issue("major", ["degs"], "ISSUE-TEXT", "EVIDENCE-TEXT", "critic")
    ledger.log("phase.finished", phase="experiment", note="EVENT-TEXT")
    ledger.add_claim("Replicates cluster by condition", ["pca"], "they do not cluster", "planner")
    ledger.register_test(
        "C2",
        "held-out replicate",
        "refit without replicate 3 and compare",
        "critic",
        script_path="/workspace/work/glhf/tests/holdout.R",
        script="x <- 1\ncat('GLHF_RESULT p_value=0.5 contradicts=false\\n')\n",
        test_null="clustering is no better than chance",
    )
    return ledger


def test_only_registered_scripts_without_a_judgement_or_a_run_are_waiting() -> None:
    ledger = _two_claims()
    ledger.register_test("C2", "words only", "no script", "critic")
    assert relevance.waiting(ledger) == [relevance.Item("T1", "C2", "held-out replicate")]
    ledger.judge_relevance("C2", "held-out replicate", Relevance(0.8, True, "ok"))
    assert relevance.waiting(ledger) == []


def test_the_request_holds_the_claim_and_the_registration_and_no_result() -> None:
    ledger = _two_claims()
    items = relevance.waiting(ledger)
    text = relevance.request(ledger, items)
    for shown in (
        "=== T1 ===",
        "Replicates cluster by condition",
        "they do not cluster",
        "held-out replicate",
        "refit without replicate 3 and compare",
        "clustering is no better than chance",
        "/workspace/work/glhf/tests/holdout.R",
        "x <- 1",
        "None has been run",
    ):
        assert shown in text, shown
    # Nothing of any result, of another claim's test, of the issues or of the event log.
    for hidden in (
        "0.0004",
        "0.031",
        "OUTPUT-TAIL",
        "NOTE-FROM-THE-CRITIC",
        "REASON-OF-ANOTHER-TEST",
        "ISSUE-TEXT",
        "EVIDENCE-TEXT",
        "EVENT-TEXT",
        "C10 lowers REST targets",
        "supported",
        "refuted",
        "verdict",
    ):
        assert hidden not in text, hidden


def test_a_long_script_is_cut_and_said_to_be_cut() -> None:
    ledger = _ledger()
    ledger.register_test(
        "C1",
        "long",
        "m",
        "critic",
        script_path=PATH,
        script="# " + "a" * 9000 + "\nEND-OF-SCRIPT\n",
    )
    text = relevance.request(ledger, relevance.waiting(ledger), script_chars=500)
    assert "[script cut here]" in text and "END-OF-SCRIPT" not in text and len(text) < 1500


def test_the_answer_is_parsed_by_code_and_an_unrated_test_has_no_score() -> None:
    items = [relevance.Item(f"T{n}", "C1", f"test {n}") for n in range(1, 8)]
    answer = "\n".join(
        [
            "Here are my ratings:",
            "T1 score=1.0 reason=Tests the claimed contrast directly.",
            "- **t2** score: 0.6, reason: An association only.",
            "T3 score=0.7 reason=Between two levels.",  # not on the rubric
            "T4 score=high reason=Very relevant.",
            "T5 score=0.8 reason=first",
            "T5 score=0.1 reason=second",  # rated twice
            "T7 score=0.1 reason=Prints a constant.",
            "T9 score=1.0 reason=No such test.",
        ]
    )
    parsed = relevance.parse(answer, items)
    assert list(parsed) == ["T1", "T2", "T3", "T4", "T5", "T6", "T7"]
    assert parsed["T1"] == (1.0, "Tests the claimed contrast directly.")
    assert parsed["T2"] == (0.6, "An association only.")
    assert parsed["T3"][0] is None and "not on the rubric" in parsed["T3"][1]
    assert parsed["T4"][0] is None and parsed["T5"] == (None, "rated twice in one answer")
    assert parsed["T6"] == (None, "the judge gave no line for this test")
    assert parsed["T7"] == (0.1, "Prints a constant.")
    assert relevance.parse("", items)["T1"][0] is None


@pytest.mark.parametrize(
    ("judge", "proposer", "same"),
    [
        ("anthropic/claude-a", "anthropic/claude-b", True),
        ("openai/gpt-x", "anthropic/claude-b", False),
        ("openrouter/anthropic/claude-a", "anthropic/claude-b", False),  # another provider
        ("mockllm/model", "mockllm/model", True),
        ("", "anthropic/claude-b", None),
    ],
)
def test_a_judgement_names_both_models_and_says_if_they_share_a_vendor(
    judge: str, proposer: str, same: bool | None
) -> None:
    made = relevance.judgement(0.8, "why", judge, proposer)
    assert (made.judge_model, made.proposer_model, made.same_vendor_as_proposer) == (
        judge,
        proposer,
        same,
    )
    assert made.relevant is True and made.threshold == 0.8 and made.judge == "relevance"
    assert relevance.judgement(0.6, "why", judge, proposer).relevant is False
    assert relevance.judgement(None, "no line", judge, proposer).relevant is False


class Judge:
    def __init__(self, answer: str = "T1 score=1.0 reason=fine", tool_call: bool = False) -> None:
        self.answer, self.tool_call, self.calls = answer, tool_call, []  # type: ignore[var-annotated]

    async def generate(self, messages: list[Any], tools: list[Any], config: Any) -> Any:
        self.calls.append((messages, tools, config))
        if self.answer == "boom":
            raise RuntimeError("connection lost")
        calls = [object()] if self.tool_call else []
        return SimpleNamespace(completion=self.answer, message=SimpleNamespace(tool_calls=calls))


def test_the_judge_is_one_call_with_its_own_instructions_and_no_tools() -> None:
    judge = Judge()
    answer, failed = asyncio.run(relevance.ask(judge, "REQUEST", 144, 30))  # type: ignore[arg-type]
    assert (answer, failed) == ("T1 score=1.0 reason=fine", None)
    [(messages, given, config)] = judge.calls
    assert given == [] and config.max_tokens == 144
    assert [m.role for m in messages] == ["system", "user"]
    assert messages[0].content == relevance.INSTRUCTIONS and messages[1].content == "REQUEST"
    # An answer that asks for a tool, and a call that fails, are no answer.
    assert asyncio.run(relevance.ask(Judge(tool_call=True), "R", 100, 30)) == ("", "tool call")  # type: ignore[arg-type]
    assert asyncio.run(relevance.ask(Judge("boom"), "R", 100, 30)) == ("", "connection lost")  # type: ignore[arg-type]


def test_the_judge_s_instructions_are_its_own_and_state_the_question_and_the_bar() -> None:
    text = relevance.INSTRUCTIONS
    assert "If the claim's null hypothesis were true, would this test's own null" in text
    assert "BEFORE it is run" in text and "You do not\nsee any result" in text
    assert "only from 0.8" in text and "score 0.1" in text
    for level in relevance.SCORES:
        assert f"\n{level:.1f} " in text
    # Not a variant of another role's prompt: none of the shared rules, and no role includes it.
    assert roles.SHARED.strip() not in text
    others = [v for k, v in vars(roles).items() if k.isupper() and isinstance(v, str)]
    assert others and all(text not in other for other in others)
    assert relevance.ROLE == "relevance"


# ------------------------------------------------------------------------------ claims engine
def test_a_critic_on_one_claim_cannot_test_or_refute_another() -> None:
    """In the claims engine each critic works on one claim (claims_solver.ClaimHooks)."""
    ledger = _ledger()
    ledger.add_claim("C2 raises the stress genes", ["degs"], "no change", "planner")
    calls = [
        (
            tools.register_falsification_test(ledger, "critic", only_claim="C1"),
            {"test_name": "t", "method": "m", "script_path": PATH, "test_null": "n"},
        ),
        (
            tools.record_falsification_test(ledger, "critic", only_claim="C1"),
            {"test_name": "t", "p_value": 0.01, "contradicts": True, "note": "n"},
        ),
        (tools.report_failed_replication(ledger, "critic", only_claim="C1"), {"note": "n"}),
    ]
    for tool, arguments in calls:
        with pytest.raises(ToolError, match="works on C1 only"):
            asyncio.run(tool(claim_id="C2", **arguments))  # type: ignore[arg-type]
    other = ledger.claims["C2"]
    assert other.registered == [] and other.verdict == "untested"
    assert not ledger.claims["C1"].registered
