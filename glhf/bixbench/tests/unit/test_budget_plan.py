"""The swarm's budget plan: floors, roll-forward, named reserves, reduced plans and the forced
hand-off turn. Pure functions and a scripted model: no Docker, no paid model.

Each test names the rule it guards. Remove the rule from solver.py and the test fails.
"""

from __future__ import annotations

import asyncio
import random

import pytest
from inspect_ai.model import (
    ChatMessage,
    ChatMessageAssistant,
    ChatMessageUser,
    ModelOutput,
    ModelUsage,
    get_model,
)

from bixbench3.inspect_harness.swarm import roles, solver

DAY = 24 * 3600 * (1 - solver.RUN_MARGIN)
HALF_HOUR = 1800 * (1 - solver.RUN_MARGIN)
TOKENS = [150_000, 200_000, 300_000, 450_000, 640_000, 1_000_000, 3_000_000, 10_000_000]
SECONDS = [HALF_HOUR, 3600.0, 6 * 3600.0, DAY]


def _rows(plan: solver.BudgetPlan) -> dict[str, dict[str, int]]:
    return {row["phase"]: row for row in solver.allocation(plan)}


# --- Rule 1: floors, roll-forward, named reserves ------------------------------------------------


def test_floors_come_from_what_each_phase_must_produce() -> None:
    assert set(solver.NEEDS) == set(solver.PHASE_ORDER)
    plan = solver.plan_budget(1_000_000, DAY)
    for kind, need in solver.NEEDS.items():
        assert need.produces and need.calls > 0 and need.seconds > 0
        assert plan.token_floors[kind] == need.calls * solver.TOKENS_PER_CALL
        assert plan.time_floors[kind] == need.seconds
    # The pilot and the full run write the most, so they need the most.
    assert plan.token_floors["experiment"] > plan.token_floors["pilot"] > plan.token_floors["scout"]


@pytest.mark.parametrize("tokens", TOKENS)
@pytest.mark.parametrize("seconds", SECONDS)
def test_no_planned_phase_is_starved_even_when_every_earlier_phase_spends_all_it_may(
    tokens: int, seconds: float
) -> None:
    # The fault this replaces: fixed shares let early roles leave a later role with nothing.
    plan = solver.plan_budget(tokens, seconds)
    rows = _rows(plan)
    for kind in plan.phases:
        assert rows[kind]["tokens"] >= plan.token_floors[kind], (plan.mode, kind)
        if kind != "finish":  # the finisher's time is the reserve finish_hold() keeps
            assert rows[kind]["seconds"] >= plan.time_floors[kind], (plan.mode, kind)
    assert rows["finish"]["seconds"] >= plan.time_reserves["finish"]
    for kind in plan.skipped:
        assert rows[kind]["tokens"] == 0 and rows[kind]["seconds"] == 0
    assert sum(row["tokens"] for row in rows.values()) <= tokens
    assert sum(row["seconds"] for row in rows.values()) <= seconds


def test_the_old_fixed_shares_would_have_starved_the_review() -> None:
    # 1,000,000 tokens, every phase spending its full share: before, the experimenter could take
    # all but the report's 10%, and audit, critique and revise got 0. Now each has its floor.
    rows = _rows(solver.plan_budget(1_000_000, HALF_HOUR))
    assert rows["experiment"]["tokens"] == 350_000
    assert (rows["audit"]["tokens"], rows["critique"]["tokens"], rows["revise"]["tokens"]) == (
        40_000,
        80_000,
        60_000,
    )


def test_unused_tokens_roll_forward_to_the_next_phase() -> None:
    plan = solver.plan_budget(1_000_000, DAY)
    book, owed = solver.TokenBook(plan), solver.Owed.of(plan)
    scout = book.grant("scout", owed.start("scout"))
    assert (scout.tokens, scout.rolled_forward) == (50_000, 0)
    settled = book.settle(scout, 10_000)  # it needed a fifth of its allowance
    assert settled["unused_rolls_forward"] == 40_000
    propose = book.grant("propose", owed.start("propose"))
    assert propose.tokens == 80_000 + 40_000 and propose.rolled_forward == 40_000
    book.settle(propose, 20_000)
    pilot = book.grant("pilot", owed.start("pilot"))
    assert pilot.tokens == 150_000 + 110_000 and pilot.rolled_forward == 110_000


def test_unused_time_rolls_forward_to_the_next_phase() -> None:
    plan = solver.plan_budget(None, DAY)
    owed = solver.Owed.of(plan)
    scout = solver.seconds_for(plan, "scout", 0, owed.start("scout"))
    assert scout == int(DAY * solver.SCOUT_SHARE)
    # The scout stopped after 100 s: the proposer gets its own share and the rest of the scout's.
    propose = solver.seconds_for(plan, "propose", 100, owed.start("propose"))
    assert propose == int(DAY * (solver.SCOUT_SHARE + solver.PLAN_SHARE) - 100)
    assert propose > int(DAY * solver.PLAN_SHARE) + scout - 101


def test_a_phase_may_not_spend_the_floors_of_the_phases_still_owed() -> None:
    plan = solver.plan_budget(1_000_000, DAY)
    book, owed = solver.TokenBook(plan), solver.Owed.of(plan)
    book.used = 280_000  # scout, proposer and pilot spent their full targets
    for kind in ("scout", "propose", "pilot"):
        owed.start(kind)
    later = owed.start("experiment")
    assert later == ["audit", "critique", "revise"]
    grant = book.grant("experiment", later)
    floors = sum(plan.token_floors[k] for k in later)
    assert grant.protected == floors + sum(plan.reserves.values())
    assert grant.tokens == 1_000_000 - 280_000 - grant.protected == 350_000
    # Time: the same rule.
    seconds = solver.seconds_for(plan, "experiment", DAY * 0.5, later)
    held = sum(plan.time_reserves.values()) + sum(plan.time_floors[k] for k in later)
    assert seconds <= DAY * 0.5 - held
    # A 30-minute run whose early roles ran late: the experimenter gets what is left before
    # the review's floors (45 + 120 + 90 s) and the reserves (300 + 87 s), not all of it.
    short = solver.plan_budget(None, HALF_HOUR)
    assert solver.seconds_for(short, "experiment", 1000, later) == 1746 - 1000 - 255 - 387
    assert solver.seconds_for(short, "audit 1", 1300, ["critique", "revise"]) == 0  # skipped
    assert solver.seconds_for(short, "critique 1", 1100, ["revise"]) == 120  # its floor


def test_an_audit_never_starves_its_critique_in_any_round() -> None:
    plan = solver.plan_budget(1_000_000, DAY)
    owed = solver.Owed.of(plan)
    for kind in ("scout", "propose", "pilot", "experiment", "audit", "critique", "revise"):
        owed.start(kind)
    assert owed.start("audit") == ["critique"]  # round 2: nothing is owed, the critique still is
    book = solver.TokenBook(plan)
    book.used = 700_000  # 110,000 left before the reserves: not enough for audit and critique
    assert book.grant("audit 2", ["critique"]).skip == "below_floor"
    assert book.grant("critique 2", []).tokens == 110_000


def test_a_role_with_less_than_its_floor_is_not_started_but_the_experimenter_is() -> None:
    plan = solver.plan_budget(1_000_000, DAY)
    book = solver.TokenBook(plan)
    book.used = 790_000  # 20,000 left before the reserves
    for title in ("pilot", "audit 1", "critique 1", "revise 1"):
        grant = book.grant(title, [])
        assert grant.skip == "below_floor" and grant.tokens < grant.floor, title
    # "finish" is its own reserve: it may spend the 40,000 held for it.
    book.used = 760_000
    assert book.grant("finish", []).skip is None
    assert book.grant("finish", []).tokens == 90_000
    experiment = book.grant("experiment", [])
    assert experiment.skip is None and 0 < experiment.tokens < experiment.floor


def test_overshoot_is_borrowed_from_named_reserves_in_order_and_never_from_the_report() -> None:
    # 200,000 tokens: experiment, finish and report, with nothing to spare.
    plan = solver.plan_budget(200_000, DAY)
    assert plan.reserves == {"overshoot": 10_000, "finish": 40_000, "report": 30_000}
    book, owed = solver.TokenBook(plan), solver.Owed.of(plan)
    experiment = book.grant("experiment", owed.start("experiment"))
    assert experiment.tokens == 120_000
    settled = book.settle(experiment, 135_000)  # one model call past its limit
    assert settled["overshoot"] == 15_000
    assert list(settled["borrowed"].items()) == [("overshoot", 10_000), ("finish", 5_000)]
    assert settled["not_covered"] == 0
    assert (
        book.reserves
        == settled["reserves_left"]
        == {
            "overshoot": 0,
            "finish": 35_000,
            "report": 30_000,
        }
    )
    # The finisher's reserve was lent, so the finisher no longer has its floor: not started.
    assert book.grant("finish", owed.start("finish")).skip == "below_floor"
    report = book.grant("report", owed.start("report"))
    assert report.tokens >= 30_000 and report.overdrawn == 0
    assert book.used + report.tokens + book.reserves["overshoot"] == 200_000


def test_an_overshoot_larger_than_the_lenders_is_reported_and_the_report_keeps_its_floor() -> None:
    plan = solver.plan_budget(200_000, DAY)
    book, owed = solver.TokenBook(plan), solver.Owed.of(plan)
    experiment = book.grant("experiment", owed.start("experiment"))
    settled = book.settle(experiment, 180_000)  # 60,000 past its allowance
    assert settled["borrowed"] == {"overshoot": 10_000, "finish": 40_000}
    assert settled["not_covered"] == 10_000
    assert book.reserves == {"overshoot": 0, "finish": 0, "report": 30_000}  # never lent
    report = book.grant("report", owed.start("report"))
    assert report.skip is None and report.tokens == 30_000 and report.overdrawn == 10_000


def test_the_overshoot_reserve_is_refilled_from_budget_that_is_nobodys_floor() -> None:
    plan = solver.plan_budget(1_000_000, DAY)
    book, owed = solver.TokenBook(plan), solver.Owed.of(plan)
    scout = book.grant("scout", owed.start("scout"))
    book.settle(scout, scout.tokens + 30_000)
    assert book.reserves["overshoot"] == 20_000
    propose = book.grant("propose", owed.start("propose"))
    # The scout's overshoot came out of the proposer's roll-forward, and the reserve is whole.
    assert propose.reserve_refilled == 30_000 and book.reserves["overshoot"] == 50_000
    assert propose.tokens == 130_000 - 80_000 and propose.tokens >= propose.floor


def test_overshoot_inside_the_reserves_leaves_every_owed_floor_intact() -> None:
    plan = solver.plan_budget(1_000_000, DAY)
    book, owed = solver.TokenBook(plan), solver.Owed.of(plan)
    for title in ("scout", "propose", "pilot", "experiment", "audit 1", "critique 1", "revise 1"):
        grant = book.grant(title, owed.start(solver.kind_of(title)))
        assert grant.skip is None and grant.tokens >= grant.floor, title
        settled = book.settle(grant, book.used + grant.tokens + 10_000)  # each passes its limit
        assert settled["not_covered"] == 0
    assert book.reserves["report"] == 100_000
    assert book.used + sum(book.reserves.values()) <= 1_000_000


def test_the_finish_reserve_is_spent_once() -> None:
    # The finisher's and the reporter's allowance already hold the finish reserve: their own
    # overshoot may not borrow it a second time.
    plan = solver.plan_budget(1_000_000, DAY)
    book = solver.TokenBook(plan)
    book.used = 500_000
    finish = book.grant("finish", [])
    assert finish.tokens == 1_000_000 - 500_000 - 100_000 - 50_000
    settled = book.settle(finish, book.used + finish.tokens + 70_000)
    assert settled["borrowed"] == {"overshoot": 50_000} and settled["not_covered"] == 20_000
    assert book.reserves["finish"] == 0


# --- Rule 2: a reduced plan is chosen up front, with numbers ---------------------------------


def test_the_plan_is_reduced_in_a_fixed_order_and_keeps_the_mandatory_phases() -> None:
    modes = [solver.plan_budget(tokens, DAY).mode for tokens in TOKENS]
    assert modes == ["below_floor", "direct", "no_review", "lean", "full", "full", "full", "full"]
    order = [name for name, _ in solver.LADDER][::-1]
    for tokens in range(20_000, 2_000_000, 20_000):
        plan = solver.plan_budget(tokens, DAY)
        assert set(solver.MANDATORY) <= set(plan.phases), plan.mode
        assert set(plan.phases) | set(plan.skipped) == set(solver.PHASE_ORDER)
        if plan.mode != solver.BELOW_FLOOR:
            # More tokens never give a smaller plan.
            bigger = solver.plan_budget(tokens + 20_000, DAY)
            assert order.index(bigger.mode) >= order.index(plan.mode)
            # The chosen plan's floors and reserves fit, and the plan says what they add up to.
            assert plan.needed["chosen"]["tokens"] <= tokens
    assert solver.plan_budget(None, DAY).mode == "full"


def test_a_plan_that_cannot_cover_the_review_drops_pilot_and_audit_first() -> None:
    plan = solver.plan_budget(450_000, DAY)
    assert plan.mode == "lean" and plan.skipped == ("pilot", "audit")
    assert plan.degraded and plan.limited_by == ("tokens",)
    assert "450,000 < 557,500 tokens" in plan.reason  # the numbers, not only the verdict
    assert plan.needed["full"]["tokens"] == 557_500
    # The experimenter is not starved to keep the supporting roles: it gets more than its floor.
    assert _rows(plan)["experiment"]["tokens"] > plan.token_floors["experiment"]
    event = plan.event()
    assert event["mode"] == "lean" and event["skipped"] == ["pilot", "audit"]
    assert event["token_floors"]["experiment"] == 120_000 and event["token_reserves"]


def test_below_the_mandatory_floors_the_plan_says_so_and_scales_them() -> None:
    plan = solver.plan_budget(10_000, HALF_HOUR)
    assert plan.mode == solver.BELOW_FLOOR and plan.phases == ("experiment", "report")
    assert "do not cover experiment + report either" in plan.reason
    assert plan.needed["chosen"]["tokens"] == 150_500 > 10_000
    assert plan.token_floors["experiment"] == 7_600 and plan.reserves["report"] == 1_900
    rows = _rows(plan)
    assert rows["experiment"]["tokens"] == 7_600 and rows["report"]["tokens"] == 1_900
    assert sum(row["tokens"] for row in rows.values()) <= 10_000


def test_too_little_time_reduces_the_plan_too() -> None:
    assert solver.plan_budget(None, HALF_HOUR).mode == "full"  # the default local run
    plan = solver.plan_budget(None, 900.0)
    assert plan.mode == "no_review" and plan.limited_by == ("time",)
    assert "900 s <" in plan.reason and plan.token_floors == {} and plan.reserves == {}
    short = solver.plan_budget(10_000_000, 300.0)
    assert short.mode == solver.BELOW_FLOOR and short.limited_by == ("time",)
    assert short.time_floors["experiment"] == int(480 * 300 / 540)
    assert short.token_floors["experiment"] == 120_000  # tokens were never the problem


def test_no_review_rounds_is_not_a_reduced_plan() -> None:
    plan = solver.plan_budget(1_000_000, DAY, review_rounds=0)
    assert plan.mode == "full" and not plan.skipped
    assert not set(solver.REVIEW_KINDS) & set(plan.phases)


# --- Total spend <= max_tokens -----------------------------------------------------------------


def _run(seed: int, max_call: float) -> tuple[solver.TokenBook, list[dict[str, object]], int]:
    """A whole run on the book alone. Every role that runs either stops early or is cut off:
    then it passed its limit by one model call (up to `max_call` of max_tokens) and spent its
    whole hand-off reserve."""
    rng = random.Random(seed)
    tokens = rng.choice([8_000, 150_000, 200_000, 450_000, 1_000_000, 4_000_000, 10_000_000])
    plan = solver.plan_budget(tokens, DAY, review_rounds=3)
    book, owed = solver.TokenBook(plan), solver.Owed.of(plan)
    titles = ["scout", "propose", "pilot", "experiment"]
    titles += [f"{kind} {n}" for n in (1, 2, 3) for kind in solver.REVIEW_KINDS]
    titles += ["finish", "report"]
    settled, overdrawn = [], 0
    for title in titles:
        kind = solver.kind_of(title)
        later = owed.start(kind)
        if kind not in plan.phases and kind != "finish":
            continue
        grant = book.grant(title, later)
        if grant.skip:
            continue
        assert grant.limit + grant.handoff == grant.tokens
        overdrawn += grant.overdrawn
        if rng.random() < 0.5:
            spent = rng.randint(0, grant.limit)
        else:
            spent = grant.limit + rng.randint(1, max(1, int(tokens * max_call))) + grant.handoff
        settled.append(book.settle(grant, book.used + spent))
    return book, settled, overdrawn


@pytest.mark.parametrize("seed", range(400))
def test_total_spend_stays_within_max_tokens_while_the_reserves_cover_the_overshoot(
    seed: int,
) -> None:
    # One call may pass a limit by up to 1% of the run: far more than one phase is cut off, and
    # the named reserves (5%, plus the finisher's) pay for all of it.
    book, settled, overdrawn = _run(seed, max_call=0.01)
    assert overdrawn == 0
    assert book.used <= book.max_tokens
    assert all(event["used"] <= book.max_tokens for event in settled)


@pytest.mark.parametrize("seed", range(400))
def test_past_the_reserves_the_excess_is_bounded_and_reported(seed: int) -> None:
    # A call of up to 30% of the run cannot be prevented (limits are checked after the call).
    # Then the book says so, and the run ends above max_tokens by no more than what it reported.
    book, settled, overdrawn = _run(seed, max_call=0.30)
    last = settled[-1]
    assert last["phase"] == "report"  # the report ran whatever happened before it
    assert book.used - book.max_tokens <= overdrawn + int(str(last["not_covered"]))
    assert any(event["not_covered"] for event in settled) or book.used <= book.max_tokens
    if overdrawn == 0 and last["not_covered"] == 0:
        assert book.used <= book.max_tokens
    assert book.reserves["report"] == book.plan.reserves["report"]  # never lent


def test_the_report_keeps_its_floor_and_reports_what_max_tokens_no_longer_covers() -> None:
    book = solver.TokenBook(solver.plan_budget(1_000_000, DAY))
    book.reserves["overshoot"] = 0
    book.used = 960_000  # a huge overshoot ate into the report's own reserve
    grant = book.grant("report", [])
    assert grant.skip is None and grant.tokens == 100_000 and grant.overdrawn == 60_000


# --- Rule 3: the forced final turn -------------------------------------------------------------


def test_every_allowance_holds_a_small_reserve_for_the_forced_final_turn() -> None:
    plan = solver.plan_budget(1_000_000, DAY)
    book, owed = solver.TokenBook(plan), solver.Owed.of(plan)
    for kind in ("scout", "propose", "pilot", "experiment", "audit", "critique", "revise"):
        grant = book.grant(kind, owed.start(kind))
        assert grant.handoff == solver.HANDOFF_TOKENS and grant.limit == grant.tokens - 3_000
        assert grant.event()["handoff_reserve"] == 3_000
    small = solver.TokenBook(solver.plan_budget(10_000, DAY)).grant("experiment", [])
    assert small.handoff == 760 and small.limit == 6_840  # never more than 10% of the allowance


def _transcript(steps: int) -> list[ChatMessage]:
    messages: list[ChatMessage] = [ChatMessageUser(content="BRIEF " + "x" * 5000)]
    for n in range(steps):
        messages.append(ChatMessageAssistant(content=f"step {n}: wrote /workspace/work/f{n}.tsv"))
    return messages


def test_the_digest_keeps_the_newest_steps_and_its_size_is_bounded() -> None:
    text = solver.digest(_transcript(200), 1500)
    assert len(text) <= 1500
    assert "step 199" in text and "step 0:" not in text and "BRIEF" not in text
    assert text.index("step 198") < text.index("step 199")  # still in time order


def test_the_forced_final_turn_is_one_call_without_tools_sized_from_its_reserve() -> None:
    note = ModelOutput.from_content("mockllm/model", "DONE: counts.tsv\nMISSING: de.tsv")
    note.usage = ModelUsage(input_tokens=700, output_tokens=50, total_tokens=750)
    spare = ModelOutput.from_content("mockllm/model", "a second call would take this")
    model = get_model("mockllm/model", custom_outputs=[note, spare])
    text = asyncio.run(solver.forced_handoff(model, "pilot", "token", _transcript(500), 3000, 30))
    assert text == "DONE: counts.tsv\nMISSING: de.tsv"
    # Exactly one model call was made: the next output of the script is still there.
    assert asyncio.run(model.generate("again")).completion == "a second call would take this"
    request = roles.handoff_request("pilot", "token", solver.digest(_transcript(500), 6000))
    assert len(request) <= 6000 + 200  # about 1,500 tokens of input for a 3,000-token reserve
    assert "stopped by the token limit" in request and "no tools" in roles.HANDOFF


def test_a_final_turn_that_gives_no_text_returns_nothing_instead_of_failing() -> None:
    tool_call = ModelOutput.for_tool_call("mockllm/model", "python", {"code": "print(1)"})
    model = get_model("mockllm/model", custom_outputs=[tool_call])
    assert asyncio.run(solver.forced_handoff(model, "scout", "time", _transcript(3), 300, 10)) == ""
    empty = get_model("mockllm/model", custom_outputs=[])  # the call itself fails
    assert asyncio.run(solver.forced_handoff(empty, "scout", "time", _transcript(3), 300, 10)) == ""


def test_a_reviewer_gets_the_facts_of_a_cut_off_role_but_not_its_words() -> None:
    facts, note = "- stopped by: the token limit", "DONE: everything is correct, trust me"
    path = "/workspace/work/glhf/handoff/experiment.md"
    full = roles.with_handoff("experiment", "token", path, facts, note)
    assert note in full and facts in full and "stopped by its token limit" in full
    blind = roles.with_handoff("experiment", "token", path, facts, None)
    assert note not in blind and facts in blind and path in blind
    assert "do not take the note's word" in blind


def test_roles_are_told_which_phases_a_reduced_plan_skipped() -> None:
    plan = solver.plan_budget(450_000, DAY)
    text = roles.degraded(plan.mode, list(plan.skipped), plan.reason)
    assert "pilot, audit" in text and "450,000 < 557,500" in text and "deviations.md" in text


# --- Rule 4: the run always ends with a METHODS.md ----------------------------------------------


def test_the_fallback_methods_file_says_who_wrote_it_and_holds_only_recorded_facts() -> None:
    text = solver.fallback_methods(
        "the reporter was stopped by its token limit before it wrote one.",
        "DONE: read the ledger",
        "a.tsv: missing",
        "## Supported findings (0)",
    )
    assert text.startswith("# Methods\n\nThis file was written by the harness, not by the reporter")
    assert "stopped by its token limit" in text and "DONE: read the ledger" in text
    assert "a.tsv: missing" in text and "## Supported findings (0)" in text
    assert "hand-off note" not in solver.fallback_methods("no time left.", "", "ok", "none")
