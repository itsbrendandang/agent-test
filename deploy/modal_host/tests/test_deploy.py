from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import deploy  # noqa: E402


def test_frozen_source_includes_committed_examples(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    assert "examples" in deploy.PARTS
    monkeypatch.setattr(deploy, "PARTS", ["examples"])
    deploy.stage(tmp_path, from_head=False)
    source = deploy.REPO / "examples"
    entries = json.loads((tmp_path / "examples/manifest.json").read_text())
    assert len(entries) == 6
    for entry in entries:
        for name in ("events.jsonl", "run.json" if entry["kind"] == "board" else "record.json"):
            assert (tmp_path / "examples" / entry["id"] / name).read_bytes() == (source / entry["id"] / name).read_bytes()
    assert not list(tmp_path.rglob("runs"))
