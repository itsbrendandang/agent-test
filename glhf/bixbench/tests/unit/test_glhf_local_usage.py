"""run.json of a local run: token use per model with the cache and reasoning split, and the git commit.

No model and no network: the usage objects are stand-ins with the fields of Inspect's ModelUsage.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from bixbench3 import glhf_local


def test_usage_keeps_cache_reasoning_and_cost_when_reported() -> None:
    full = SimpleNamespace(
        input_tokens=1200,
        output_tokens=300,
        total_tokens=9500,
        input_tokens_cache_read=8000,
        input_tokens_cache_write=0,
        reasoning_tokens=120,
        total_cost=0.0123,
    )
    assert glhf_local.usage_summary({"anthropic/claude-sonnet-5-5": full}) == {
        "anthropic/claude-sonnet-5-5": {
            "input_tokens": 1200,
            "output_tokens": 300,
            "total_tokens": 9500,
            "input_tokens_cache_read": 8000,
            "input_tokens_cache_write": 0,
            "reasoning_tokens": 120,
            "total_cost": 0.0123,
        }
    }


def test_usage_leaves_out_what_was_not_reported() -> None:
    unreported = SimpleNamespace(
        input_tokens=10,
        output_tokens=5,
        total_tokens=15,
        input_tokens_cache_read=None,
        input_tokens_cache_write=None,
        reasoning_tokens=None,
        total_cost=None,
    )
    older = SimpleNamespace(input_tokens=1, output_tokens=2, total_tokens=3)
    assert glhf_local.usage_summary({"a": unreported, "b": older}) == {
        "a": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
        "b": {"input_tokens": 1, "output_tokens": 2, "total_tokens": 3},
    }
    assert glhf_local.usage_summary({}) == {}


def test_usage_reads_inspect_model_usage() -> None:
    from inspect_ai.model import ModelUsage

    usage = ModelUsage(
        input_tokens=4, output_tokens=2, total_tokens=6, input_tokens_cache_read=1, total_cost=0.5
    )
    row = glhf_local.usage_summary({"m": usage})["m"]
    assert row["input_tokens_cache_read"] == 1
    assert row["total_cost"] == 0.5
    assert "reasoning_tokens" not in row


def test_git_state_names_the_commit_of_this_checkout() -> None:
    state = glhf_local.git_state()
    assert set(state) == {"git_commit", "git_dirty"}
    if state["git_commit"] is None:
        pytest.skip("not a git checkout")
    assert re.fullmatch(r"[0-9a-f]{40}", state["git_commit"])
    assert isinstance(state["git_dirty"], bool)


def test_git_state_is_none_without_git(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def no_git(*args: object, **kwargs: object) -> None:
        raise FileNotFoundError("git")

    monkeypatch.setattr(glhf_local.subprocess, "run", no_git)
    assert glhf_local.git_state() == {"git_commit": None, "git_dirty": None}
    monkeypatch.undo()

    def fails(*args: object, **kwargs: object) -> None:
        raise subprocess.CalledProcessError(128, "git")

    monkeypatch.setattr(glhf_local.subprocess, "run", fails)
    assert glhf_local.git_state(tmp_path) == {"git_commit": None, "git_dirty": None}
