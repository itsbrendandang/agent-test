"""glhf/scripts/eval_adapter.py: the claude and openai answerers refuse while NO_PAID_CALLS is on."""

from __future__ import annotations

import importlib.util
import urllib.request
from pathlib import Path

import pytest
from bixbench3.paid import PaidCallsOff

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "eval_adapter.py"


def _load():
    spec = importlib.util.spec_from_file_location("eval_adapter", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.mark.parametrize("name", ["claude", "openai"])
def test_paid_answerers_refuse(name, monkeypatch):
    monkeypatch.setenv("NO_PAID_CALLS", "1")

    def no_network(*a, **k):
        raise AssertionError("network call made")

    monkeypatch.setattr(urllib.request, "urlopen", no_network)
    mod = _load()
    monkeypatch.setattr(mod, "_load_dotenv", no_network)
    with pytest.raises(PaidCallsOff):
        mod.get_answers(name, [], {}, None)


def test_free_answerers_still_work(monkeypatch):
    monkeypatch.setenv("NO_PAID_CALLS", "1")
    mod = _load()
    assert mod.get_answers("always-a", [], {}, None) == {}
