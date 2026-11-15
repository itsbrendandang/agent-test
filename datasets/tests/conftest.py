"""Tests are offline. They read recorded fixtures and never reach the network.

The two variables are set before the scripts are imported: common.py refuses every request that
is not in its cache when DATASET_SCOUT_OFFLINE is 1, and the cache folder is an empty temp folder.
"""

import json
import os
import sys
import tempfile
from pathlib import Path

os.environ["DATASET_SCOUT_OFFLINE"] = "1"
os.environ["DATASET_SCOUT_DIR"] = tempfile.mkdtemp(prefix="dataset-scout-tests-")
os.environ.pop("DATASET_SCOUT_OPERATOR", None)
sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))

import pytest  # noqa: E402

FIXTURES = HERE / "fixtures"
CATALOG = HERE.parent / "catalog.jsonl"


def load(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


@pytest.fixture()
def good_record():
    """A valid record, built the way a fetcher builds one."""
    import schema

    return schema.make_record(
        id="example:alpha",
        name="Alpha set",
        source="example",
        url="https://example.org/alpha",
        domains=["chemistry", "admet"],
        modality="tabular",
        description="Solubility of 1,000 compounds.",
        licence_raw="cc-by-4.0",
        retrieved_at="2026-01-31T12:00:00Z",
        how_retrieved="GET https://example.org/api",
        fetcher="fetch_example.py",
    )


@pytest.fixture(scope="session")
def catalog():
    return [json.loads(line) for line in CATALOG.read_text(encoding="utf-8").splitlines() if line.strip()]
