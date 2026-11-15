"""The swarm's roles as data, for the dashboard: `python -m bixbench3.inspect_harness.swarm.catalog`.

Instructions and budget shares are read from roles.py and solver.py, so this cannot drift from
what actually runs.
"""

from __future__ import annotations

import json

from . import relevance, roles, solver, tools


def _own(text: str) -> str:
    """A role's instructions without the rules every role shares."""
    for base in (roles.EXPERIMENTER, roles.SHARED):
        if text.startswith(base) and text != base:
            return text[len(base) :].strip()
    return text.removeprefix(roles.SHARED).strip()


def _pct(share: float) -> str:
    return f"{share * 100:g}%"


def _floor(kind: str) -> str:
    need = solver.NEEDS[kind]
    tokens = need.calls * solver.TOKENS_PER_CALL
    return f"floor {need.seconds} s and about {tokens:,} tokens (enough for {need.produces})"


def _early(kind: str) -> str:
    time_share = _pct(solver.TIME_TARGET[kind])
    token_share = _pct(solver.TOKEN_TARGET[kind])
    return (
        f"up to {time_share} of the time and {token_share} of the tokens, plus what earlier "
        f"phases left unused, never the floors of later phases or the reserves; {_floor(kind)}"
    )


def catalog() -> dict[str, object]:
    review = "of the review time left in each round"
    room = (
        f"the phases before review leave {solver.REVIEW_MARGIN:g} times the "
        f"{_pct(solver.MIN_REVIEW_SHARE)} of the run (at most "
        f"{solver.MIN_REVIEW_SECONDS // 60} minutes) a round needs to start"
    )
    rows = [
        ("scout", "planner", roles.SCOUT, _early("scout")),
        ("propose", "planner", roles.PLANNER, _early("propose")),
        ("pilot", "experimenter", roles.PILOT, _early("pilot")),
        ("experiment", "experimenter", roles.EXPERIMENTER, _early("experiment")),
        (
            "audit",
            "critic",
            roles.AUDITOR,
            f"{_pct(solver.AUDIT_SHARE)} {review}, at most "
            f"{_pct(solver.TOKEN_SHARE['audit'])} of the tokens; {_floor('audit')}",
        ),
        (
            "critique",
            "critic",
            roles.CRITIC,
            f"{_pct(solver.CRITIQUE_SHARE)} {review}, at most "
            f"{_pct(solver.TOKEN_SHARE['critique'])} of the tokens; {_floor('critique')}; {room}",
        ),
        (
            "relevance",
            "critic",
            relevance.INSTRUCTIONS,
            f"{_pct(solver.RELEVANCE_SHARE)} {review} after the critique, at most "
            f"{_pct(solver.TOKEN_SHARE['relevance'])} of the tokens; one model call without "
            f"tools; {_floor('relevance')}. The registered tests are then run by the harness "
            f"(no tokens; up to {_pct(solver.EXECUTE_SHARE)} of the review time left, at most "
            f"{tools.TEST_SECONDS // 60} minutes a test)",
        ),
        (
            "revise",
            "experimenter",
            roles.REVISER,
            f"{_pct(solver.REVISE_SHARE)} {review} (90% in the last round); {_floor('revise')}",
        ),
        (
            "finish",
            "experimenter",
            roles.FINISHER,
            f"{_pct(solver.FINISH_RESERVE)} held back (at least {solver.MIN_FINISH_SECONDS // 60} minutes "
            "on runs of 20 minutes or more) and a token reserve of its floor; runs only if an "
            "output is missing or unreadable",
        ),
        (
            "report",
            "reporter",
            roles.REPORTER,
            f"{_pct(solver.REPORT_RESERVE)} of the time and {_pct(solver.REPORT_TOKEN_RESERVE)} of "
            "the tokens always kept for the write-up; it always runs",
        ),
    ]
    return {
        "shared_rules": roles.SHARED,
        "budget_plan": (
            "The plan is fixed before the first role runs (solver.plan_budget). Plans tried in "
            "order, the first whose floors and reserves fit both limits wins: "
            + "; ".join(
                f"{name} (drops {', '.join(dropped)})" if dropped else name
                for name, dropped in solver.LADDER
            )
            + ". A role that hits a limit gets one short final turn without tools to write a "
            "hand-off note. Every decision is a budget.* or handoff.* event in the ledger."
        ),
        "roles": [
            {"key": key, "model_group": group, "budget": budget, "instructions": _own(text)}
            for key, group, text, budget in rows
        ],
    }


if __name__ == "__main__":
    print(json.dumps(catalog()))
