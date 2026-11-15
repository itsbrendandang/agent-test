"""Tests use the scripted model and fakes only. No model, no network, and no
.env is loaded: the paid switch is forced ON for every test unless the test
itself sets it (always together with a fake client)."""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

FAKE_KEY = "sk-fake-not-a-key-0000"


@pytest.fixture(autouse=True)
def _paid_calls_off(monkeypatch):
    monkeypatch.setenv("NO_PAID_CALLS", "1")
    for key in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.setenv(key, "")
