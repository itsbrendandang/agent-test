"""A synthetic capsule for the tests: tiny data, a solution notebook that must never be staged,
and secret fields that carry sentinel strings. No benchmark data is used or needed."""

from __future__ import annotations

import io
import json
import shutil
import subprocess
import zipfile
from dataclasses import dataclass
from pathlib import Path

import pytest

from bixbench_v1.dataset import Capsule, group_capsules, load_questions

UUID = "11111111-2222-3333-4444-555555555555"
# Every secret field holds one of these, so a leak anywhere is a plain substring search.
SENTINELS = {
    "ideal": "SENTINEL_IDEAL the long free-text ideal answer",
    "distractor": "SENTINEL_DISTRACTOR",
    "hypothesis": "SENTINEL_HYPOTHESIS that the treatment changes expression",
    "result": "SENTINEL_RESULT the treatment changed expression",
    "paper": "https://doi.org/10.0000/SENTINEL_PAPER",
    "categories": "SENTINEL_CATEGORY",
    "canary": "SENTINEL_CANARY 00000000-1111-2222-3333-444444444444",
    "notebook": "SENTINEL_NOTEBOOK the executed solution",
}


def _row(number: int, question: str, eval_mode: str, ideal: str) -> dict[str, object]:
    return {
        "id": f"00000000-0000-0000-0000-00000000000{number}",
        "question_id": f"syn-1-q{number}",
        "short_id": "syn-1",
        "capsule_uuid": UUID,
        "data_folder": f"CapsuleFolder-{UUID}.zip",
        "question": question,
        "eval_mode": eval_mode,
        "ideal": ideal,
        "distractors": [f"{SENTINELS['distractor']}_{i}" for i in range(3)],
        "hypothesis": SENTINELS["hypothesis"],
        "result": SENTINELS["result"],
        "answer": True,
        "paper": SENTINELS["paper"],
        "categories": SENTINELS["categories"],
        "canary": SENTINELS["canary"],
        "tag": "synthetic",
        "version": "test",
    }


ROWS = [
    _row(1, "What is the sum of column a in counts.csv?", "str_verifier", "4"),
    _row(2, "What is the mean of column b in counts.csv?", "range_verifier", "(2.9,3.1)"),
    _row(3, "Describe the data in one phrase.", "llm_verifier", SENTINELS["ideal"]),
]


def _nested_zip(names: list[str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name in names:
            archive.writestr(name, "x")
    return buffer.getvalue()


@dataclass
class Synthetic:
    hub: Path
    staged: Path
    capsule: Capsule
    zip_path: Path


@pytest.fixture
def synthetic(tmp_path: Path) -> Synthetic:
    hub = tmp_path / "hub"
    hub.mkdir()
    zip_path = hub / f"CapsuleFolder-{UUID}.zip"
    notebook = json.dumps({"cells": [{"source": SENTINELS["notebook"]}]})
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr(f"CapsuleData-{UUID}/counts.csv", "gene,a,b\ng1,1,2\ng2,3,4\n")
        archive.writestr(f"CapsuleData-{UUID}/nested/meta.txt", "samples: 2\n")
        archive.writestr(
            f"CapsuleData-{UUID}/results.busco.zip", _nested_zip(["run/full_table.tsv"])
        )
        # Everything below must stay out of the sandbox.
        archive.writestr(f"CapsuleNotebook-{UUID}/CapsuleNotebook-{UUID}_executed.ipynb", notebook)
        archive.writestr(f"CapsuleData-{UUID}/CapsuleNotebook-{UUID}_executed.ipynb", notebook)
        archive.writestr(f"CapsuleData-{UUID}/analysis.Rmd", SENTINELS["notebook"])
        archive.writestr(f"CapsuleData-{UUID}/report.html", SENTINELS["notebook"])
        archive.writestr(f"CapsuleData-{UUID}/solve.py", SENTINELS["notebook"])
        archive.writestr(f"CapsuleData-{UUID}/bundle.zip", _nested_zip(["inner/solution.ipynb"]))
        archive.writestr("README.md", SENTINELS["result"])
        archive.writestr("__MACOSX/._counts.csv", "x")
    (hub / "BixBench.jsonl").write_text("\n".join(json.dumps(row) for row in ROWS) + "\n")
    capsule = group_capsules(load_questions(hub / "BixBench.jsonl"))[0]
    return Synthetic(hub, tmp_path / "staged", capsule, zip_path)


def docker_running() -> bool:
    if shutil.which("docker") is None:
        return False
    return subprocess.run(["docker", "info"], capture_output=True, check=False).returncode == 0
