"""The NO_PAID_CALLS kill switch for this package. One rule and one implementation: it is
`bixbench3.paid` (see there), which this package already depends on.

It is ON unless NO_PAID_CALLS is exactly "0", in the environment or in the repository's .env.
While it is on, `bixbench-v1 run` and `bixbench-v1 grade` refuse any model that is not the
scripted one (the solver's model, a role's model, the LLM judge), and the provider keys are blank
in this process. `--model mock`, `--no-judge`, download, list, audit and report keep working.

Not covered: code that calls `run_capsule` or `InspectJudge` itself instead of this command line.

Modal is covered too: `refuse_modal` is called before every Modal deploy, request and sandbox
(glhf/openmodels, the `--sandbox modal` option). A model served from our own endpoint
(`openai-api/<service>/<model>`) is a paid model like any other while the switch is on.
"""

from __future__ import annotations

import os
from collections.abc import Iterable, MutableMapping

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


# --- Modal and OpenAI-compatible endpoints we serve ourselves (glhf/openmodels) ---------------

ENDPOINT_PREFIX = (
    "openai-api/"  # Inspect: openai-api/<service>/<model>, <SERVICE>_BASE_URL/_API_KEY
)


def refuse_modal(what: str) -> None:
    """Call right before anything that uses Modal: a deploy, a request to a model served there, a
    sandbox, a volume upload. Modal bills by the second, so it is a paid call like any other:
    refused while the switch is on."""
    _paid.refuse_paid(f"Modal ({what})")


def endpoint_service(model: str) -> str | None:
    """The service name in `openai-api/<service>/<model>`, or None for any other model id."""
    if not model.startswith(ENDPOINT_PREFIX):
        return None
    service, sep, name = model[len(ENDPOINT_PREFIX) :].partition("/")
    return service if sep and service and name else None


def is_endpoint_model(model: str) -> bool:
    return endpoint_service(model) is not None


def isolate_endpoint(
    models: Iterable[str], *, judge: bool, environ: MutableMapping[str, str] | None = None
) -> bool:
    """A run whose models are all served from our own endpoint, graded without the LLM judge,
    needs no vendor key. Blank them all (blank, not removed, so no .env loader puts them back):
    then the only place the run can reach is the endpoint named by <SERVICE>_BASE_URL. The key of
    that service itself is kept (it may be one of the named keys). Returns whether the keys were
    blanked. With a vendor model among them, or a judge, nothing changes."""
    names = list(models)
    if judge or not names or not all(is_endpoint_model(m) for m in names):
        return False
    env = os.environ if environ is None else environ
    # A hosted service's own key (TINKER_API_KEY for openai-api/tinker/...) is what the run needs.
    own = {f"{str(endpoint_service(m)).upper().replace('-', '_')}_API_KEY" for m in names}
    for key in PAID_KEYS:
        if key not in own:
            env[key] = ""
    return True
