"""The claims engine loop with a scripted stand-in for the roles: every path a claim can take, the
ablation flags, retries, the global stop, and claims worked on in parallel."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from bixbench3.inspect_harness.swarm.board import (
    EVENTS_FILE,
    REJECTIONS_FILE,
    Board,
    ClaimRecord,
)
from bixbench3.inspect_harness.swarm.claim_budget import Pool
from bixbench3.inspect_harness.swarm.engine import CallResult, Check, Left, Limits, run_claims
from bixbench3.inspect_harness.swarm.flags import SwarmFlags
from bixbench3.inspect_harness.swarm.ledger import Ledger

LIMITS = Limits(reserved_tokens=1_000, min_claim_tokens=500, reserved_seconds=10.0)
CURRENT: dict[str, FakeHooks] = {}  # the hooks of the run in progress, for the verdict stand-in


@dataclass
class Script:
    """What each claim does. `verdicts` is the ledger verdict after each critique round."""

    pilot_ok: bool = True
    verdicts: list[str] = field(default_factory=lambda: ["supported"])
    issue_rounds: set[int] = field(default_factory=set)  # rounds that raise a blocking issue
    errors: dict[str, int] = field(default_factory=dict)  # mode -> how many calls raise first
    artifacts: bool = True


class FakeHooks:
    def __init__(
        self,
        ledger: Ledger,
        scripts: dict[str, Script],
        *,
        tokens_left: int | None = 1_000_000,
        seconds_left: float = 1e6,
        delay: float = 0.0,
    ) -> None:
        self.ledger, self.scripts = ledger, scripts
        self.tokens_left, self.seconds_left, self.delay = tokens_left, seconds_left, delay
        self.calls: list[tuple[str, str, str, int | None, int]] = []
        self.active = 0
        self.most_at_once = 0
        self.rounds_seen: list[int] = []
        self.verdict: dict[str, str] = {}

    async def call(
        self, role: str, mode: str, record: ClaimRecord, tokens: int | None, attempt: int
    ) -> CallResult:
        self.calls.append((role, mode, record.id, tokens, attempt))
        self.active += 1
        self.most_at_once = max(self.most_at_once, self.active)
        try:
            await asyncio.sleep(self.delay)
            script = self.scripts[record.id]
            base = mode.split()[0]
            if script.errors.get(base, 0) > 0:
                script.errors[base] -= 1
                raise RuntimeError(f"{base} crashed")
            if base == "critique":
                n = int(mode.split()[1])
                if n in script.issue_rounds:
                    self.ledger.raise_issue(
                        "blocking", record.artifact_ids, "wrong contrast", "design", "critic"
                    )
            if base == "revise":
                for issue in self.ledger.open_issues():
                    if set(issue.artifact_ids) & set(record.artifact_ids):
                        self.ledger.resolve_issue(
                            issue.id, "fixed", "contrast fixed", "experimenter"
                        )
            if self.tokens_left is not None:
                self.tokens_left -= 100
            return CallResult("ok", tokens=100, seconds=1.0, model="mockllm/model")
        finally:
            self.active -= 1

    async def pilot_passed(self, record: ClaimRecord) -> Check:
        ok = self.scripts[record.id].pilot_ok
        return Check(
            ok,
            "pilot outputs pass the shape check" if ok else "pilot output degs.csv is empty",
            {"artifact": "degs"},
        )

    async def artifacts_present(self, record: ClaimRecord) -> Check:
        ok = self.scripts[record.id].artifacts
        return Check(ok, "artifacts present" if ok else "degs.csv is missing")

    async def after_critique(self, round_no: int) -> None:
        self.rounds_seen.append(round_no)
        for claim_id, script in self.scripts.items():
            verdicts = script.verdicts
            self.verdict[claim_id] = verdicts[min(round_no, len(verdicts)) - 1]

    def left(self) -> Left:
        return Left(self.tokens_left, self.seconds_left)


def _setup(
    scripts: dict[str, Script], tmp_path: Path | None = None, **hook_args: Any
) -> tuple[Board, Ledger, FakeHooks]:
    ledger = Ledger()
    board = Board("run-1", out_dir=tmp_path)
    for n, claim_id in enumerate(scripts, 1):
        claim = ledger.add_claim(f"claim {n}", [f"art{n}"], "no effect", "proposer")
        assert claim.id == claim_id
        board.add(claim_id, f"claim {n}", [f"art{n}"], "high" if n == 1 else "low", "proposer")
    hooks = FakeHooks(ledger, scripts, **hook_args)
    return board, ledger, hooks


@pytest.fixture(autouse=True)
def _ledger_verdict_from_script(monkeypatch: pytest.MonkeyPatch) -> None:
    """review_outcome reads ledger.claims[id].verdict; point it at the script's verdict."""
    from bixbench3.inspect_harness.swarm import ledger as ledger_module

    def verdict(self: Any) -> str:
        hooks = CURRENT.get("hooks")
        return hooks.verdict.get(self.id, "untested") if hooks else "untested"

    monkeypatch.setattr(ledger_module.Claim, "verdict", property(verdict))
    CURRENT.clear()


def _run(
    board: Board,
    ledger: Ledger,
    hooks: FakeHooks,
    flags: SwarmFlags | None = None,
    pool: Pool | None = None,
):
    CURRENT["hooks"] = hooks
    return asyncio.run(
        run_claims(
            board, ledger, hooks, flags or SwarmFlags(), pool or Pool(100_000, 3600.0), LIMITS
        )
    )


def test_the_smallest_slice_one_dead_on_arrival_one_supported_after_one_send_back(
    tmp_path: Path,
) -> None:
    scripts = {
        "C1": Script(verdicts=["supported", "supported"], issue_rounds={1}),
        "C2": Script(pilot_ok=False),
    }
    board, ledger, hooks = _setup(scripts, tmp_path)
    summary = _run(board, ledger, hooks)
    assert summary.states == {"C1": "supported", "C2": "rejected"}
    path = [h.to_state for h in board.claims["C1"].history]
    assert path == [
        "piloting",
        "in_workup",
        "under_review",
        "sent_back",
        "in_workup",
        "under_review",
        "supported",
    ]
    rejected = json.loads((tmp_path / REJECTIONS_FILE).read_text())
    assert [(r["claim"], r["stage"]) for r in rejected] == [("C2", "pilot")]
    assert rejected[0]["reason"].startswith("dead on arrival")
    kinds = [json.loads(line)["kind"] for line in (tmp_path / EVENTS_FILE).read_text().splitlines()]
    assert kinds.index("flags") < kinds.index("agent.call") and kinds[-1] == "engine.finished", (
        "flags are logged before any work"
    )
    assert {"agent.call", "claim.transition", "budget.allocated", "retriage"} <= set(kinds)
    modes = [(m, c) for _, m, c, _, _ in hooks.calls]
    assert ("pilot", "C2") in modes and not any(c == "C2" and m != "pilot" for m, c in modes), (
        "a dead claim costs nothing more"
    )
    assert ("revise 1", "C1") in modes, "a revision carries its round"


@pytest.mark.parametrize(
    ("script", "expected"),
    [
        (Script(verdicts=["refuted"]), "rejected"),
        (Script(verdicts=["insufficient"]), "not_established"),
        (
            Script(verdicts=["supported"], issue_rounds={1, 2}),
            "not_established",
        ),  # still open after 2 rounds
        (Script(artifacts=False), "not_established"),
        (Script(errors={"workup": 2}), "not_established"),  # crashed twice: not a rejection
    ],
)
def test_each_way_a_claim_can_end(script: Script, expected: str) -> None:
    board, ledger, hooks = _setup({"C1": script})
    assert _run(board, ledger, hooks).states["C1"] == expected
    if expected == "not_established":
        assert not board.rejections(), "only a code check or the ledger rejects a claim"


def test_one_crash_is_retried_and_the_claim_goes_on() -> None:
    board, ledger, hooks = _setup({"C1": Script(errors={"workup": 1})})
    assert _run(board, ledger, hooks).states["C1"] == "supported"
    assert [a for _, m, _, _, a in hooks.calls if m == "workup"] == [1, 2]
    assert board.claims["C1"].errors and "workup attempt 1" in board.claims["C1"].errors[0]


def test_a_crashing_claim_never_stops_the_other_claims() -> None:
    board, ledger, hooks = _setup({"C1": Script(errors={"pilot": 5}), "C2": Script()})
    assert _run(board, ledger, hooks).states == {"C1": "not_established", "C2": "supported"}


def test_no_pilot_goes_straight_to_workup() -> None:
    board, ledger, hooks = _setup({"C1": Script(pilot_ok=False)})
    assert _run(board, ledger, hooks, SwarmFlags(pilot=False)).states["C1"] == "supported"
    assert not any(m == "pilot" for _, m, _, _, _ in hooks.calls)
    assert board.claims["C1"].history[0].to_state == "in_workup"


def test_every_claims_run_has_a_critic() -> None:
    """The critic cannot be switched off: it is the role that tests each claim independently."""
    assert not hasattr(SwarmFlags(), "critic")
    with pytest.raises(TypeError):
        SwarmFlags.from_options(no_critic=True)  # type: ignore[call-arg]
    board, ledger, hooks = _setup({"C1": Script(), "C2": Script()})
    _run(board, ledger, hooks, SwarmFlags(auditor=False, pilot=False, retriage=False))
    critiqued = {c for r, _, c, *_ in hooks.calls if r == "critic"}
    assert critiqued == {"C1", "C2"}, "every claim under review is critiqued"


def test_no_auditor_runs_the_critic_only() -> None:
    board, ledger, hooks = _setup({"C1": Script()})
    _run(board, ledger, hooks, SwarmFlags(auditor=False))
    assert {r for r, *_ in hooks.calls} == {"experimenter", "critic"}


def test_no_review_at_all_leaves_claims_not_established() -> None:
    board, ledger, hooks = _setup({"C1": Script()})
    summary = _run(board, ledger, hooks, SwarmFlags(review_rounds=0))
    assert summary.states["C1"] == "not_established" and summary.rounds == 0
    assert board.claims["C1"].history[-1].reason == "no review ran (review is off)"


def test_the_global_stop_closes_open_claims_and_keeps_the_reserves() -> None:
    board, ledger, hooks = _setup({"C1": Script(), "C2": Script()}, tokens_left=1_400)
    summary = _run(board, ledger, hooks)
    assert summary.stopped and "tokens left" in summary.stopped
    assert set(summary.states.values()) == {"not_established"}
    assert hooks.tokens_left is not None and hooks.tokens_left >= 1_000, (
        "the reserve is never spent on claims"
    )


def test_without_a_token_budget_roles_get_no_token_cap() -> None:
    board, ledger, hooks = _setup({"C1": Script()}, tokens_left=None)
    _run(board, ledger, hooks, pool=Pool(0, 600.0))
    assert all(tokens is None for *_, tokens, _ in hooks.calls)


def test_claims_run_in_parallel_up_to_the_cap() -> None:
    scripts = {f"C{n}": Script() for n in range(1, 6)}
    board, ledger, hooks = _setup(scripts, delay=0.01)
    _run(board, ledger, hooks, SwarmFlags(max_parallel=2))
    assert hooks.most_at_once == 2
    board, ledger, hooks = _setup(scripts | {}, delay=0.01)
    _run(board, ledger, hooks, SwarmFlags(max_parallel=1))
    assert hooks.most_at_once == 1


def test_tokens_spent_add_up_per_claim() -> None:
    board, ledger, hooks = _setup(
        {"C1": Script(issue_rounds={1}, verdicts=["supported", "supported"]), "C2": Script()}
    )
    _run(board, ledger, hooks)
    for claim_id in ("C1", "C2"):
        calls = [c for c in hooks.calls if c[2] == claim_id]
        assert board.claims[claim_id].budget.tokens_spent == 100 * len(calls)
    assert all(t is not None and t > 0 for *_, t, _ in hooks.calls), "every call had a token cap"


def test_retriage_off_is_logged_and_moves_nothing(tmp_path: Path) -> None:
    board, ledger, hooks = _setup(
        {
            "C1": Script(issue_rounds={1}, verdicts=["supported", "supported"]),
            "C2": Script(pilot_ok=False),
        },
        tmp_path,
    )
    _run(board, ledger, hooks, SwarmFlags(retriage=False))
    events = [json.loads(line) for line in (tmp_path / EVENTS_FILE).read_text().splitlines()]
    retriages = [e for e in events if e["kind"] == "retriage"]
    assert retriages and all(e["enabled"] is False and e["moved_tokens"] == 0 for e in retriages)
    assert next(e for e in events if e["kind"] == "flags")["retriage"] is False


def test_flags_are_checked() -> None:
    with pytest.raises(ValueError):
        SwarmFlags(max_parallel=0)
    with pytest.raises(ValueError):
        SwarmFlags(review_rounds=9)
    flags = SwarmFlags.from_options(no_auditor=True, no_pilot=True)
    assert (flags.pilot, flags.auditor, flags.retriage) == (False, False, True)


def test_every_review_round_gets_its_own_review_tokens() -> None:
    """Audit, critique and revise draw on one review share; each round gets its part of it, so a
    claim sent back twice still has review tokens in round 3."""
    board, ledger, hooks = _setup(
        {"C1": Script(issue_rounds={1, 2}, verdicts=["supported", "supported", "supported"])}
    )
    _run(board, ledger, hooks, SwarmFlags(review_rounds=3))
    caps = {mode: tokens for _, mode, claim_id, tokens, _ in hooks.calls if claim_id == "C1"}
    assert {"audit 3", "critique 3", "revise 1", "revise 2"} <= set(caps)
    assert all(caps[m] and caps[m] > 0 for m in ("audit 3", "critique 3"))
    assert caps["critique 3"] > caps["critique 1"], "what a round did not use rolls forward"
    spent = board.claims["C1"].budget.stage_tokens_spent
    assert spent["critique"] == 100 * 3 and spent["revise"] == 100 * 2
