"""The NO_PAID_CALLS kill switch for this package. One rule and one implementation: it is
`bixbench3.paid` (see there), which this package already depends on.

It is ON unless NO_PAID_CALLS is exactly "0", in the environment or in the repository's .env.
While it is on, `bixbench-v1 run` and `bixbench-v1 grade` refuse any model that is not the
scripted one (the solver's model, a role's model, the LLM judge), and the provider keys are blank
in this process. `--model mock`, `--no-judge`, download, list, audit and report keep working.

Not covered: code that calls `run_capsule` or `InspectJudge` itself instead of this command line.
"""

from __future__ import annotations

from bixbench3 import paid as _paid

SWITCH: str = _paid.SWITCH
HOW_TO_ALLOW: str = _paid.HOW_TO_ALLOW
PAID_KEYS: tuple[str, ...] = _paid.PAID_KEYS
PaidCallsOff: type[RuntimeError] = _paid.PaidCallsOff


def paid_calls_off() -> bool:
    return bool(_paid.paid_calls_off())


def enforce() -> bool:
    """Blank the provider keys while the switch is on. Run before .env is loaded: `load_env`
    leaves a variable that is already set alone, so the blanks stay."""
    return bool(_paid.enforce())


def refuse_models(*models: str) -> None:
    """Refuse any model that is not the scripted one while the switch is on."""
    _paid.refuse_models(*models)


def refuse_judge(model: str) -> None:
    """Refuse the LLM judge while the switch is on; `--no-judge` grades by code rules only."""
    if not _paid.is_mock(model):
        _paid.refuse_paid(f"the LLM judge ({model}); grade with --no-judge instead")
