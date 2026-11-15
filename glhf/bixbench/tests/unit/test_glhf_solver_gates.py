"""The swarm's orchestration without Docker or a model: the sandbox, the clock, the agents and
the limits are fakes, so each gate in solver.solve can be driven to its edge. Mutant ids are in
the test names."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from inspect_ai.agent import AgentState

from bixbench3.inspect_harness.models import ExpectedOutput, NetworkAccessPolicy
from bixbench3.inspect_harness.swarm import memory, past_memory, solver, tools
from bixbench3.inspect_harness.swarm.ledger import Ledger

OK = [{"artifact_id": "degs", "path": "/outputs/degs.csv", "problems": [], "warnings": []}]
BROKEN = [
    {"artifact_id": "degs", "path": "/outputs/degs.csv", "problems": ["missing"], "fatal": True}
]


class World:
    """Everything solve() touches outside itself."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.t0 = self.now = 1000.0
        self.spend: dict[str, float | None] = {}  # seconds a role uses; None = its whole slice
        self.default_spend: float | None = 0.0
        self.cut: set[str] = set()  # roles ended by their time limit
        self.returns_at: dict[str, float] = {}  # role -> seconds into the run when it comes back
        self.contract: list[dict[str, Any]] = OK
        self.files: dict[str, str] = {}
        self.runs: list[SimpleNamespace] = []
        self.agents: dict[str, SimpleNamespace] = {}
        self.searches: list[tuple[Any, ...]] = []
        self.kills: list[bool] = []
        self.calls: list[str] = []  # the order of what happened: "run:<role>", "kill", "persist"
        self.persisted: list[dict[str, Any]] = []  # the ledger each time the trusted copy is kept
        self.jobs: list[dict[str, Any]] = []  # background processes the sandbox reports
        # What a role does during its turn (a role's turns in order), e.g. register a test.
        self.acts: dict[str, list[Any]] = {}
        self.tokens = 0  # tokens the sample has used
        self.token_spend: dict[str, int] = {}  # tokens a role's turn costs
        # The relevance judge: every request it was sent, and how it answers.
        self.judge_requests: list[str] = []
        self.judge: Any = lambda text: (
            "\n".join(
                f"T{n} score=1.0 reason=bears on it" for n in range(1, text.count("=== T") + 1)
            ),
            None,
        )
        self.judge_seconds = 0.0
        # The harness's runs of registered tests: (command, options), and what a run prints.
        self.test_runs: list[tuple[list[str], dict[str, Any]]] = []
        self.test_output = "GLHF_RESULT p_value=0.0004 contradicts=false\n"
        self.test_seconds = 1.0
        self.ledger = Ledger()
        self.case = SimpleNamespace(
            task_id="5",
            doi="10.1234/abc.5",
            expected_outputs=[ExpectedOutput(artifact_id="degs", path="degs.csv", format="csv")],
            network_policy=NetworkAccessPolicy(answer_source_domains=["journal.example"]),
        )
        self.state = SimpleNamespace(
            metadata_as=lambda _cls: self.case,
            input_text="BRIEF",
            messages=[],
            output=SimpleNamespace(completion=""),
        )
        world = self

        class Box:
            async def exec(self, cmd: list[str], **options: Any) -> SimpleNamespace:
                if "input" in options:  # the harness running a registered test script
                    world.test_runs.append((cmd, options))
                    world.calls.append("test")
                    world.now += world.test_seconds
                    return SimpleNamespace(
                        success=True, returncode=0, stdout=world.test_output, stderr=""
                    )
                found = cmd[:2] != ["test", "-s"] or cmd[2] in world.files
                return SimpleNamespace(success=found, stdout="", stderr="")

            async def write_file(self, path: str, text: str) -> None:
                world.files[path] = text

            async def read_file(self, path: str) -> str:
                return world.files[path]

        async def save_ledger(_: Ledger) -> None: ...

        async def check_contract(
            outputs: object, root: str | None = None, columns: object = None
        ) -> list[dict[str, Any]]:
            return OK if root else world.contract

        async def background_processes(kill: bool = False) -> list[dict[str, Any]]:
            world.kills.append(kill)
            if kill:
                world.calls.append("kill")
            return list(world.jobs)

        def persist_ledger(ledger: Ledger) -> None:
            world.calls.append("persist")
            world.persisted.append(json.loads(ledger.to_json()))

        async def forced_handoff(*args: Any) -> str:
            world.now += args[-1]  # the forced final turn uses the seconds it is given
            return "scripted hand-off note"

        def react(*, name: str, prompt: str, tools: list[Any], **_: object) -> SimpleNamespace:
            world.agents[name] = SimpleNamespace(name=name, prompt=prompt, tools=tools)
            return world.agents[name]

        async def run(who: SimpleNamespace, prompt: str, limits: list[tuple[str, int]]) -> Any:
            seconds = dict(limits)["time"]
            at = world.now - world.t0
            used = world.spend.get(who.name, world.default_spend)
            world.now += seconds if used is None else min(used, seconds)
            if who.name in world.returns_at:  # a role that comes back late, whatever its limit
                world.now = world.t0 + world.returns_at[who.name]
            world.runs.append(
                SimpleNamespace(role=who.name, prompt=prompt, limits=dict(limits), at=at)
            )
            world.calls.append(f"run:{who.name}")
            world.tokens += world.token_spend.get(who.name, 0)
            if world.acts.get(who.name):
                world.acts[who.name].pop(0)(world)
            error = SimpleNamespace(type="time") if who.name in world.cut else None
            return AgentState(messages=[]), error

        async def ask(model: object, text: str, max_tokens: int, seconds: int) -> Any:
            world.judge_requests.append(text)
            world.calls.append("judge")
            world.now += world.judge_seconds
            return world.judge(text)

        def search_docs(*args: object) -> tuple[Any, ...]:
            world.searches.append(args)
            return ("search_docs", *args)

        for name, fake in {
            "sandbox": lambda: Box(),
            "save_ledger": save_ledger,
            "check_contract": check_contract,
            "background_processes": background_processes,
            "persist_ledger": persist_ledger,
            "forced_handoff": forced_handoff,
            "get_model": lambda *_, **__: "model",
            "react": react,
            "run": run,
            "search_docs": search_docs,
            "Ledger": lambda: world.ledger,
            "time": SimpleNamespace(monotonic=lambda: world.now),
            "sample_limits": lambda: SimpleNamespace(token=SimpleNamespace(usage=world.tokens)),
            "time_limit": lambda n: ("time", n),
            "message_limit": lambda n: ("message", n),
            "token_limit": lambda n: ("token", n),
            "bash_session": lambda **_: "bash_session",
            "python": lambda **_: "python",
            "text_editor": lambda **_: "text_editor",
            "request_web_access": lambda: "request_web_access",
        }.items():
            monkeypatch.setattr(solver, name, fake)
        monkeypatch.setattr(solver.relevance, "ask", ask)
        # The real harness runner (tools.run_registered_test) on the fake sandbox and clock.
        monkeypatch.setattr(tools, "sandbox", lambda: Box())
        monkeypatch.setattr(tools, "time", SimpleNamespace(monotonic=lambda: world.now))
        monkeypatch.delenv("PAST_API_KEY", raising=False)
        monkeypatch.delenv("EXA_API_KEY", raising=False)

    def solve(self, **settings: Any) -> None:
        asyncio.run(solver.glhf_swarm(**settings)(self.state, None))  # type: ignore[arg-type]

    def events(self, kind: str) -> list[dict[str, Any]]:
        return [e for e in self.ledger.events if e["kind"] == kind]

    @property
    def started(self) -> dict[str, int]:
        return {e["phase"]: e["seconds"] for e in self.events("phase.started")}


@pytest.fixture
def world(monkeypatch: pytest.MonkeyPatch) -> World:
    return World(monkeypatch)


# --- time ---------------------------------------------------------------------------------------
def test_the_phases_share_the_time_limit_minus_the_margin_S26(world: World) -> None:
    world.solve(budget_seconds=1000)
    assert world.events("settings")[0]["budget_seconds"] == 970
    # Nothing was spent, so the reporter may use all but the final-writes share of the sample.
    assert world.started["report"] == 1000 - 30


@pytest.mark.parametrize(("back_at", "starts"), [(965.0, False), (960.0, True)])
def test_a_phase_with_under_ten_seconds_is_skipped_not_started_S11(
    world: World, back_at: float, starts: bool
) -> None:
    # 1000 s sample. The experimenter comes back 965 s in: after the 30 s kept for the final
    # writes the reporter would have 5 s, under MIN_PHASE_SECONDS, so it is not started and
    # code writes METHODS.md. Back at 960 s it has exactly 10 s and runs.
    world.returns_at = {"experimenter": back_at}
    world.solve(budget_seconds=1000)
    skipped = [(e["phase"], e["reason"], e.get("seconds")) for e in world.events("phase.skipped")]
    assert (("report", "time", 5) in skipped) is not starts
    assert ("reporter" in [r.role for r in world.runs]) is starts
    assert all(seconds >= solver.MIN_PHASE_SECONDS for seconds in world.started.values())
    if starts:
        assert world.started["report"] == solver.MIN_PHASE_SECONDS
        assert world.events("report.fallback")[0]["reporter_ran"] is True  # it wrote nothing
    else:
        assert world.events("report.fallback")[0]["reporter_ran"] is False
        assert "written by the harness" in world.files["/outputs/METHODS.md"]


def test_review_never_spends_the_finisher_reserve_S19_S27(world: World) -> None:
    # 1300 s run, every role uses its whole slice, and the critic is cut off in every round
    # with nothing raised, so review goes on for as long as it is allowed to. An artifact is
    # missing at the end: the finisher must still find its five minutes, and the reporter its
    # reserve, however much review wanted.
    world.default_spend = None
    world.cut = {"critic"}
    world.contract = BROKEN
    world.solve(budget_seconds=1300)
    plan = solver.plan_budget(None, 1300 * (1 - solver.RUN_MARGIN))
    review = [p for p in world.started if p.startswith(("audit", "critique", "revise"))]
    assert review == ["critique 1"]  # the reduced plan of a run this short has no audit
    assert world.started["finish"] >= solver.MIN_FINISH_SECONDS == plan.time_reserves["finish"]
    assert world.started["report"] >= plan.time_reserves["report"]
    # The round that no longer had the time was not started, and the ledger says so.
    assert world.events("review.skipped") == [
        {"kind": "review.skipped", "round": 2, "reason": "time"}
    ]


def test_the_phases_before_review_leave_room_for_one_round(world: World) -> None:
    # A 28-minute run where every early role is cut off at the end of its slice and uses its
    # forced final turn too. The floors of the early phases used to leave the review floors
    # only (275 s), which is less than the phases before review must leave
    # (REVIEW_MARGIN x min_review_seconds = 297 s here): on a short run review was planned and
    # never started.
    world.default_spend = None
    world.cut = {"scout", "planner", "pilot", "experimenter"}
    world.solve(budget_seconds=1700)
    budget = 1700 * (1 - solver.RUN_MARGIN)
    plan = world.events("budget.plan")[0]
    assert plan["mode"] == "full" and world.events("review.skipped") == []
    assert world.started["experiment"] == 670  # 689 with the review floors alone
    auditor = next(r for r in world.runs if r.role == "auditor")
    left_for_review = budget - auditor.at - sum(plan["time_reserves"].values())
    assert left_for_review >= solver.REVIEW_MARGIN * solver.min_review_seconds(budget) - 1
    assert "critique 1" in world.started
    assert solver.REVIEW_MARGIN == 1.2


def test_the_finisher_cannot_spend_the_report_reserve_S29(world: World) -> None:
    world.contract = BROKEN
    world.solve(budget_seconds=2000, review_rounds=0)
    budget = 2000 * (1 - solver.RUN_MARGIN)
    assert world.started["finish"] == int(budget - budget * solver.REPORT_RESERVE)  # 1843, not 1940


def test_the_report_time_is_measured_against_the_sample_limit_S38() -> None:
    clock = solver.Clock(970.0, 0.0, 1000.0)
    solver_time = solver.time
    try:
        solver.time = SimpleNamespace(monotonic=lambda: 500.0)  # type: ignore[assignment]
        assert clock.report_seconds() == 1000 - 500 - 30
        assert solver.Clock(970.0, 0.0).report_seconds() == 970 - 500 - 30  # no total: the budget
    finally:
        solver.time = solver_time


# --- limits and money -----------------------------------------------------------------------------
def test_every_phase_carries_the_message_limit_S14(world: World) -> None:
    world.solve(budget_seconds=1800, max_messages_per_role=7)
    assert len(world.runs) >= 6
    assert all(r.limits.get("message") == 7 for r in world.runs), [r.limits for r in world.runs]
    world.runs.clear()
    world.ledger = Ledger()
    world.solve(budget_seconds=1800)
    assert all("message" not in r.limits and "token" not in r.limits for r in world.runs)


def test_search_is_off_unless_asked_for_and_never_given_to_critic_or_reporter_S15_S16_S34(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    world.solve(budget_seconds=1800)
    assert world.searches == []  # exa=False: no role has the tool, whatever its name
    assert not any("search_docs" in str(a.tools) for a in world.agents.values())
    assert solver.roles.SEARCH not in "".join(a.prompt for a in world.agents.values())

    monkeypatch.setenv("EXA_API_KEY", "test-key")
    world.ledger = Ledger()
    world.solve(budget_seconds=1800, exa=True)
    assert {args[1] for args in world.searches} == {
        "scout",
        "planner",
        "pilot",
        "experimenter",
        "reviser",
        "finisher",
        "auditor",
    }
    # The critic holds the verdicts and the reporter writes the lessons: neither may search.
    for name in ("critic", "reporter"):
        assert not any("search_docs" in str(t) for t in world.agents[name].tools)
    # Every search tool is bound to this run's ledger (the shared cap), the case's network
    # policy and the case's DOI. The BixBench3 case record has no title and no authors.
    for ledger, _, policy, doi, titles, authors in world.searches:
        assert ledger is world.ledger
        assert policy is world.case.network_policy and doi == "10.1234/abc.5"
        assert titles == [] and authors == []


def test_a_case_record_with_a_title_and_authors_has_them_guarded_in_every_search(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    world.case.title = "REST repression of neuronal genes"
    world.case.authors = ["Okonkwo A", "M\u00fcller"]
    monkeypatch.setenv("EXA_API_KEY", "test-key")
    world.solve(budget_seconds=1800, exa=True)
    assert len(world.searches) == len(solver.SEARCH_ROLES)
    for *_, titles, authors in world.searches:
        assert titles == ["REST repression of neuronal genes"]
        assert authors == ["Okonkwo A", "M\u00fcller"]


def test_exa_without_a_key_stops_the_run_before_any_phase_S17(world: World) -> None:
    with pytest.raises(RuntimeError, match="EXA_API_KEY"):
        world.solve(budget_seconds=1800, exa=True)
    assert world.runs == []


# --- end of run -----------------------------------------------------------------------------------
def test_background_jobs_are_killed_before_the_report_and_again_after_it_S23(world: World) -> None:
    world.cut = {"experimenter"}
    world.jobs = [{"pid": 41, "cmd": "sh -c while true; do cp forged.json ledger.json; done"}]
    world.solve(budget_seconds=1800)
    # Once before the report (nothing writes to /outputs after review), once after it (the
    # reporter is a role too: one left a loop rewriting the ledger copy), and the record that
    # counts is kept after both.
    assert world.kills.count(True) == 2
    order = [c for c in world.calls if c in ("kill", "run:reporter") or c == "persist"]
    first, reporter = order.index("kill"), order.index("run:reporter")
    second = len(order) - 1 - order[::-1].index("kill")
    assert first < reporter < second < len(order) - 1 and order[-1] == "persist"
    killed = world.events("background.killed")
    assert [e.get("after") for e in killed] == [None, "report"]
    assert all(e["processes"] == world.jobs for e in killed)


def test_the_record_of_the_run_is_kept_by_the_solver_process_and_is_the_last_thing_done(
    world: World,
) -> None:
    world.solve(budget_seconds=1800)
    # The final copy holds the whole run, the "finished" event included, and nothing in it
    # was read back from the sandbox: the fake sandbox here never returns a ledger.
    assert world.calls[-1] == "persist"
    final = world.persisted[-1]
    assert final["events"][-1]["kind"] == "finished"
    assert final == json.loads(world.ledger.to_json())


def test_a_run_whose_critic_never_finished_a_pass_says_it_is_unreviewed(world: World) -> None:
    world.cut = {"critic"}
    world.solve(budget_seconds=1800)
    assert len(world.events("review.none")) == 1
    assert world.events("review.none")[0]["rounds_planned"] == 3
    assert "## NOT REVIEWED" in world.files["/outputs/glhf/FINDINGS.md"]
    assert "review.none" in [e["kind"] for e in world.persisted[-1]["events"]]


def test_a_reviewed_run_and_a_run_without_planned_review_are_not_called_unreviewed(
    world: World,
) -> None:
    world.solve(budget_seconds=1800)  # the critic completes its pass
    assert world.events("review.none") == []
    assert "NOT REVIEWED" not in world.files["/outputs/glhf/FINDINGS.md"]
    world.ledger = Ledger()
    world.solve(budget_seconds=1800, review_rounds=0)  # review was not asked for
    assert world.events("review.none") == []


def test_a_contract_check_that_could_not_run_is_logged_and_starts_no_finisher_S36(
    world: World,
) -> None:
    world.contract = [{"artifact_id": "*", "problems": ["contract check failed to run: boom"]}]
    world.solve(budget_seconds=1800, review_rounds=0)
    assert len(world.events("contract.check_failed")) == 1
    assert "finish" not in world.started


# --- memory ---------------------------------------------------------------------------------------
def _approved(folder: Path, task: str, lesson: str, context: tuple[str, ...] = ()) -> None:
    memory.add_pending(str(folder), task, lesson, context)
    assert memory.decide(folder, None, approve=True)[1] == []


def test_a_run_is_never_shown_lessons_from_its_own_task_S18(world: World, tmp_path: Path) -> None:
    _approved(tmp_path, "5", "- sort by name before counting")  # this task
    _approved(tmp_path, "8", "- index the genome first", ("5",))  # written after reading task 5
    _approved(tmp_path, "9", "- pin the annotation version")
    world.solve(budget_seconds=1800, memory_dir=str(tmp_path))
    prompts = "\n".join(r.prompt for r in world.runs)
    assert "pin the annotation version" in prompts
    assert "sort by name" not in prompts and "index the genome" not in prompts
    settings = world.events("settings")[0]
    assert settings["memory_from_tasks"] == ["9"] and settings["memory_source"] == "file"


def test_lessons_are_filtered_and_queued_with_their_context_S24_S25(
    world: World, tmp_path: Path
) -> None:
    _approved(tmp_path, "9", "- pin the annotation version")
    world.files[f"{solver.WORK}/lessons.md"] = (
        "- check the delimiter early\n- BRCA1 was the top hit\n"
    )
    world.solve(budget_seconds=1800, memory_dir=str(tmp_path))
    # The copy in /outputs is the filtered one: a result line never leaves the sandbox as a lesson.
    assert world.files["/outputs/glhf/lessons.md"] == "- check the delimiter early\n"
    assert len(world.events("memory.rejected")[0]["lines"]) == 1
    # The run read task 9's lessons, so its own lesson may never be shown to task 9.
    [(_, section, line)] = memory.pending_lessons(tmp_path)
    assert (section.task, section.context, line) == ("5", ["9"], "- check the delimiter early")
    assert world.events("memory.pending")[0]["context"] == ["9"]
    memory.decide(tmp_path, None, approve=True)
    assert "delimiter" not in memory.read_memory(str(tmp_path), "9")


def test_lessons_recalled_from_past_dev_set_the_context_S33(
    world: World, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def recall(task_id: str) -> tuple[str, set[str]]:
        assert task_id == "5"
        return "- pin the annotation version", {"9", "12"}

    monkeypatch.setattr(past_memory, "enabled", lambda: True)
    monkeypatch.setattr(past_memory, "recall_with_sources", recall)
    world.files[f"{solver.WORK}/lessons.md"] = "- check the delimiter early\n"
    world.solve(budget_seconds=1800, memory_dir=str(tmp_path))
    assert world.events("settings")[0]["memory_from_tasks"] == ["12", "9"]
    [(_, section, _)] = memory.pending_lessons(tmp_path)
    assert section.context == ["12", "9"]


def test_the_reporter_writes_lessons_only_when_memory_is_on_S37(
    world: World, tmp_path: Path
) -> None:
    world.solve(budget_seconds=1800)
    assert solver.roles.LESSONS not in world.agents["reporter"].prompt
    assert "/outputs/glhf/lessons.md" not in world.files
    world.ledger = Ledger()
    world.solve(budget_seconds=1800, memory_dir=str(tmp_path))
    assert solver.roles.LESSONS in world.agents["reporter"].prompt


# --- falsification tests: registered scripts, the relevance judge, the harness's run --------------
def _claim(world: World) -> None:
    world.ledger.add_claim(
        "C10 lowers REST targets", ["degs"], "no change in REST targets", "planner"
    )


def _registers(name: str = "permutation", claim: str = "C1", suffix: str = ".py") -> Any:
    """A critic's turn: write a test script and register it (what the tool does)."""

    def act(world: World) -> None:
        path = f"{solver.WORK}/tests/{name.replace(' ', '_')}{suffix}"
        world.files[path] = f"# {name}\nprint('GLHF_RESULT p_value=0.0004 contradicts=false')\n"
        world.ledger.register_test(
            claim,
            name,
            "permute the condition labels 10000 times",
            "critic",
            script_path=path,
            script=world.files[path],
            test_null="the labels do not matter",
        )

    return act


def test_a_registered_test_is_judged_then_run_by_the_harness_and_no_role_types_a_result(
    world: World,
) -> None:
    world.acts = {"planner": [_claim], "critic": [_registers()]}
    world.solve(budget_seconds=1800)
    claim = world.ledger.claims["C1"]
    assert claim.verdict == "supported" and claim.e_value == 25.0
    # Order: the critic's turn, then the judge, then the harness's run. Nothing in between.
    turn = world.calls.index("run:critic")
    assert world.calls[turn + 1 : turn + 3] == ["judge", "test"]
    kinds = [e["kind"] for e in world.ledger.events]
    assert (
        kinds.index("test.registered")
        < kinds.index("test.relevance")
        < kinds.index("test.executed")
        < kinds.index("test.recorded")
    )
    # The harness ran the registered content itself, in the work folder, with a time limit.
    [(command, options)] = world.test_runs
    entry = claim.registered[0]
    assert command == ["python3", "-"] and options["input"] == entry.script
    assert options["cwd"] == solver.WORK and 10 <= options["timeout"] <= tools.TEST_SECONDS
    assert entry.run is not None and entry.run.status == "ok" and entry.run.seconds == 1.0
    assert (claim.tests[0].source, claim.tests[0].by) == ("harness", "harness")
    # The judge is a review phase of its own in the ledger, with its own budget line.
    assert "relevance 1" in world.started
    relevance_grant = next(e for e in world.events("budget.grant") if e["phase"] == "relevance 1")
    assert relevance_grant["seconds_floor"] == 20 and relevance_grant["handoff_seconds"] == 0


def test_the_judge_is_shown_the_registration_and_nothing_else(world: World) -> None:
    def earlier_results(w: World) -> None:
        _registers("first test")(w)
        w.ledger.raise_issue(
            "major", ["degs"], "SECRET-ISSUE the contrast is reversed", "e", "critic"
        )

    world.acts = {
        "planner": [_claim],
        "experimenter": [
            lambda w: w.files.__setitem__(f"{solver.WORK}/notebook.md", "SECRET-REASONING")
        ],
        "critic": [earlier_results],
    }
    world.test_output = "SECRET-OUTPUT\nGLHF_RESULT p_value=0.0004 contradicts=false\n"
    world.solve(budget_seconds=1800)
    [request] = world.judge_requests
    assert "C10 lowers REST targets" in request and "no change in REST targets" in request
    assert "permute the condition labels 10000 times" in request
    assert "the labels do not matter" in request and "# first test" in request
    for hidden in ("SECRET", "verdict", "mean e", "I1", "notebook"):
        assert hidden not in request, hidden
    assert "None has been run" in request


def test_an_irrelevant_test_is_run_and_recorded_and_is_refused_as_support(world: World) -> None:
    world.acts = {"planner": [_claim], "critic": [_registers("positive control")]}
    world.judge = lambda text: (
        "T1 score=0.2 reason=A control that passes whatever the claim.",
        None,
    )
    world.solve(budget_seconds=1800)
    claim = world.ledger.claims["C1"]
    assert len(world.test_runs) == 1  # it was still run
    assert claim.tests[0].p_value == 0.0004 and claim.tests[0].counts is False
    assert claim.verdict == "insufficient" and claim.e_value == 0.0
    judged = world.events("test.relevance")[0]
    assert (judged["score"], judged["relevant"], judged["threshold"]) == (0.2, False, 0.8)
    assert "Supported findings (0)" in world.files["/outputs/glhf/FINDINGS.md"]


def test_a_test_the_judge_did_not_rate_is_not_relevant(world: World) -> None:
    def two(w: World) -> None:
        _registers("permutation")(w)
        _registers("held-out replicate")(w)

    world.acts = {"planner": [_claim], "critic": [two]}
    world.judge = lambda text: ("T2 score=1.0 reason=fine", None)  # no line for T1
    world.solve(budget_seconds=1800)
    first, second = world.ledger.claims["C1"].registered
    assert first.relevance is not None and first.relevance.score is None
    assert first.relevance.relevant is False and second.relevance is not None
    assert second.relevance.relevant is True
    # The unrated test stays in the mean as zero: (0 + 25) / 2.
    assert world.ledger.claims["C1"].e_value == 12.5
    assert len(world.test_runs) == 2


def test_without_a_judgement_a_test_is_not_run_and_cannot_support(world: World) -> None:
    world.acts = {"planner": [_claim], "critic": [_registers()]}
    world.judge = lambda text: ("", "time")  # the judge gave no answer
    world.solve(budget_seconds=1800)
    claim = world.ledger.claims["C1"]
    assert world.test_runs == [] and claim.registered[0].relevance is None
    assert claim.verdict == "untested" and claim.pending == ["permutation"]
    failed = world.events("relevance.failed")[0]
    assert failed["reason"] == "time" and failed["tests"] == ["C1/permutation"]
    assert "not judged for relevance" in world.files["/outputs/glhf/FINDINGS.md"]


def test_a_test_left_unjudged_is_asked_about_again_in_the_next_round(world: World) -> None:
    answers = [("", "connection lost"), ("T1 score=1.0 reason=fine", None)]
    world.acts = {"planner": [_claim], "critic": [_registers()]}
    world.judge = lambda text: answers.pop(0)
    world.cut = {"critic"}  # cut off with nothing raised: the review goes another round
    world.solve(budget_seconds=3600)
    assert len(world.judge_requests) == 2 and len(world.test_runs) == 1
    assert world.ledger.claims["C1"].verdict == "supported"
    assert [p for p in world.started if p.startswith("relevance")] == ["relevance 1", "relevance 2"]


def test_the_judge_is_not_called_when_nothing_is_waiting_or_the_critic_did_not_run(
    world: World,
) -> None:
    world.acts = {"planner": [_claim]}
    world.solve(budget_seconds=1800)  # the critic registers nothing
    assert world.judge_requests == [] and "relevance 1" not in world.started
    assert world.events("relevance.skipped") == []


def test_the_judge_is_paid_from_the_review_share_and_skipped_below_its_floor(world: World) -> None:
    world.acts = {"planner": [_claim], "critic": [_registers()]}
    world.solve(budget_seconds=1800, max_tokens=1_000_000)
    grant = next(e for e in world.events("budget.grant") if e["phase"] == "relevance 1")
    assert grant["floor"] == 10_000 and grant["tokens"] == 20_000  # 2% of max_tokens
    assert solver.TOKEN_SHARE["relevance"] == 0.02 and solver.RELEVANCE_SHARE == 0.05
    plan = world.events("budget.plan")[0]
    assert plan["token_floors"]["relevance"] == 10_000 and plan["time_floors"]["relevance"] == 20
    assert len(world.test_runs) == 1

    # The critic passes its limit by so much that the judge's floor is gone: the judge is
    # skipped, the ledger says so, the test is not run, and the reporter still runs.
    world.ledger = Ledger()
    world.tokens, world.test_runs, world.judge_requests, world.runs = 0, [], [], []
    world.acts = {"planner": [_claim], "critic": [_registers()]}
    world.token_spend = {"critic": 900_000}
    world.solve(budget_seconds=1800, max_tokens=1_000_000)
    skipped = [(e["phase"], e["reason"]) for e in world.events("phase.skipped")]
    assert ("relevance 1", "below_floor") in skipped
    note = world.events("relevance.skipped")[0]
    assert note["tests"] == ["C1/permutation"] and "cannot support" in note["note"]
    assert world.judge_requests == [] and world.test_runs == []
    assert world.ledger.claims["C1"].verdict == "untested"
    assert "reporter" in [r.role for r in world.runs]


def test_a_plan_without_review_has_no_judge_and_the_critique_leaves_it_its_floor() -> None:
    full = solver.plan_budget(1_000_000, 86_400)
    assert full.phases.index("critique") + 1 == full.phases.index("relevance")
    assert "relevance" in solver.REVIEW_KINDS and solver.NEEDS["relevance"].seconds == 20
    lean = solver.plan_budget(450_000, 86_400)
    assert lean.mode == "lean" and "relevance" in lean.phases  # the judge is kept with the critic
    for tokens in (300_000, 200_000, 100_000, 10_000):
        plan = solver.plan_budget(tokens, 86_400)
        assert ("critique" in plan.phases) == ("relevance" in plan.phases), plan.mode
    # In every round the critique may not spend the judge's floor, in tokens or in seconds.
    owed = solver.Owed.of(full)
    for kind in solver.PHASE_ORDER[:-2]:
        owed.start(kind)
    later = owed.start("critique")  # round 2
    assert later == ["relevance"]
    book = solver.TokenBook(full)
    book.used = 700_000
    grant = book.grant("critique 2", later)
    assert grant.protected == full.token_floors["relevance"] + sum(full.reserves.values())
    short = solver.plan_budget(None, 1746)
    without = solver.seconds_for(short, "critique 2", 1100, [])
    assert solver.seconds_for(short, "critique 2", 1100, later) == min(
        without, 1746 - 1100 - 387 - 20
    )


def test_the_tests_run_on_review_time_only_and_one_without_time_is_not_started(
    world: World,
) -> None:
    def three(w: World) -> None:
        for name in ("a", "b", "c"):
            _registers(name)(w)

    world.acts = {"planner": [_claim], "critic": [three]}
    world.test_seconds = 40.0
    world.solve(budget_seconds=1800)
    budget = 1800 * (1 - solver.RUN_MARGIN)
    hold = 300 + 87  # the finisher's and the reporter's reserves
    # Each test may use half of the review time then left, shared with the tests still
    # waiting, and never more than TEST_SECONDS.
    timeouts = [options["timeout"] for _, options in world.test_runs]
    assert len(timeouts) == 3 and all(10 <= t <= tools.TEST_SECONDS for t in timeouts)
    assert timeouts[0] == int(min(300, (budget - hold) * solver.EXECUTE_SHARE / 3))
    assert solver.EXECUTE_SHARE == 0.5 and tools.TEST_SECONDS == 300

    # The judge answers so late that less than 10 s per test is left: none is started, each is
    # logged, and nothing was taken from the reserves.
    world.ledger = Ledger()
    world.test_runs, world.runs = [], []
    world.now = world.t0
    world.acts = {"planner": [_claim], "critic": [three]}
    world.judge_seconds = budget - hold - 15  # 15 s of review time left after the judge
    world.solve(budget_seconds=1800)
    assert world.test_runs == []
    not_run = world.events("test.not_run")
    assert [e["name"] for e in not_run] == ["a", "b", "c"] and not_run[0]["reason"] == "time"
    assert world.ledger.claims["C1"].pending == ["a", "b", "c"]
    assert world.started["report"] >= 87


@pytest.mark.parametrize(
    ("planner", "critic", "judge", "same"),
    [
        ("openai/gpt-x", "openai/gpt-y", None, True),
        ("openai/gpt-x", "anthropic/claude-z", None, False),
        ("openai/gpt-x", "openai/gpt-y", "google/gemini-q", False),
        (None, None, None, True),  # everything on the default model
    ],
)
def test_the_run_records_whether_the_judge_is_on_the_proposer_s_vendor(
    world: World, planner: str | None, critic: str | None, judge: str | None, same: bool
) -> None:
    world.acts = {"planner": [_claim], "critic": [_registers()]}
    world.solve(
        budget_seconds=1800, planner_model=planner, critic_model=critic, relevance_model=judge
    )
    setting = world.events("settings")[0]["relevance"]
    assert setting["same_vendor_as_proposer"] is same and setting["threshold"] == 0.8
    assert setting["judge_model"] == (judge or critic or "model")
    assert setting["proposer_model"] == (planner or "model")
    entry = world.events("test.relevance")[0]
    assert entry["same_vendor_as_proposer"] is same
    assert entry["judge_model"] == setting["judge_model"]
    assert world.events("settings")[0]["role_models"]["relevance"] == setting["judge_model"]
