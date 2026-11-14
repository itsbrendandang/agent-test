"""The swarm's roles as data, for the dashboard: `python -m bixbench3.inspect_harness.swarm.catalog`.

Instructions and budget shares are read from roles.py and solver.py, so this cannot drift from
what actually runs.
"""

from __future__ import annotations

import json

from . import roles, solver


def _own(text: str) -> str:
    """A role's instructions without the rules every role shares."""
    for base in (roles.EXPERIMENTER, roles.SHARED):
        if text.startswith(base) and text != base:
            return text[len(base) :].strip()
    return text.removeprefix(roles.SHARED).strip()


def _pct(share: float) -> str:
    return f"{share * 100:g}%"


def catalog() -> dict[str, object]:
    review = "of the review time left in each round"
    rows = [
        ("scout", "planner", roles.SCOUT, f"{_pct(solver.SCOUT_SHARE)} of the run"),
        ("propose", "planner", roles.PLANNER, f"{_pct(solver.PLAN_SHARE)} of the run"),
        ("pilot", "experimenter", roles.PILOT, f"{_pct(solver.PILOT_SHARE)} of the run"),
        (
            "experiment",
            "experimenter",
            roles.EXPERIMENTER,
            f"{_pct(solver.FIRST_PASS_SHARE)} of the run",
        ),
        ("audit", "critic", roles.AUDITOR, f"{_pct(solver.AUDIT_SHARE)} {review}"),
        ("critique", "critic", roles.CRITIC, f"{_pct(solver.CRITIQUE_SHARE)} {review}"),
        ("revise", "experimenter", roles.REVISER, f"most {review}"),
        (
            "finish",
            "experimenter",
            roles.FINISHER,
            f"{_pct(solver.FINISH_RESERVE)} held back; runs only if an output is missing",
        ),
        (
            "report",
            "reporter",
            roles.REPORTER,
            f"{_pct(solver.REPORT_RESERVE)} always kept for the write-up",
        ),
    ]
    return {
        "shared_rules": roles.SHARED,
        "roles": [
            {"key": key, "model_group": group, "budget": budget, "instructions": _own(text)}
            for key, group, text, budget in rows
        ],
    }


if __name__ == "__main__":
    print(json.dumps(catalog()))
