"""The integrity boundary, part 1: what a capsule zip may put into /data."""

from __future__ import annotations

import io
import json
import tarfile
import zipfile
from pathlib import Path

import pytest
from conftest import SENTINELS, UUID, Synthetic

from bixbench_v1 import staging


def _files(root: Path) -> set[str]:
    return {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}


def test_only_input_files_are_staged(synthetic: Synthetic) -> None:
    data = staging.stage_capsule(synthetic.zip_path, synthetic.staged / UUID)
    assert _files(data) == {"counts.csv", "nested/meta.txt", "results.busco.zip"}
    manifest = json.loads((synthetic.staged / UUID / "manifest.json").read_text())
    reasons = {e["member"].split("/", 1)[-1]: e["reason"] for e in manifest["excluded"]}
    assert reasons[f"CapsuleNotebook-{UUID}_executed.ipynb"] == "notebook folder or notebook file"
    assert reasons["analysis.Rmd"] == "notebook file"
    assert reasons["report.html"] == "rendered report or write-up"
    assert reasons["solve.py"] == "analysis script"
    assert reasons["bundle.zip"].startswith("archive contains a notebook")
    assert reasons["README.md"] == "outside the capsule's data folder"
    assert reasons["._counts.csv"] == "operating-system metadata"
    # The manifest sits beside /data, not in it, and no sentinel text reached the data.
    assert not (data / "manifest.json").exists()
    staged_bytes = b"".join(p.read_bytes() for p in data.rglob("*") if p.is_file())
    assert all(s.encode() not in staged_bytes for s in SENTINELS.values())


@pytest.mark.parametrize(
    ("member", "excluded"),
    [
        ("CapsuleData-x/counts.csv", False),
        ("CapsuleData-x/sub/dir/table.xlsx", False),
        ("CapsuleFolder-x/CapsuleData-x/reads.fastq.gz", False),
        ("CapsuleNotebook-x/nb.ipynb", True),
        ("CapsuleData-x/CapsuleNotebook-x_postprocessed_executed.ipynb", True),
        ("CapsuleData-x/My Notebook Outputs/table.csv", True),
        ("CapsuleData-x/analysis.ipynb", True),
        ("CapsuleData-x/analysis.qmd", True),
        ("CapsuleData-x/summary.PDF", True),
        ("CapsuleData-x/script.R", True),
        ("CapsuleData-x/../escape.csv", True),
        ("/CapsuleData-x/absolute.csv", True),
        ("loose_file.csv", True),
        ("Other/table.csv", True),
    ],
)
def test_exclusion_rule(member: str, excluded: bool) -> None:
    assert (staging.exclusion_reason(member) is not None) is excluded


def test_nested_archives_are_inspected() -> None:
    def zipped(names: list[str]) -> bytes:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            for name in names:
                archive.writestr(name, "x")
        return buffer.getvalue()

    assert staging.archive_problem("ok.zip", zipped(["a/b.faa", "run/log.txt"])) is None
    assert "notebook" in str(staging.archive_problem("bad.zip", zipped(["a/solution.ipynb"])))
    assert "report" in str(staging.archive_problem("bad.zip", zipped(["a/report.html"])))
    inner = zipped(["deep/nb.ipynb"])
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("inner.zip", inner)
    assert "notebook" in str(staging.archive_problem("outer.zip", buffer.getvalue()))
    tar_buffer = io.BytesIO()
    with tarfile.open(fileobj=tar_buffer, mode="w:gz") as tar:
        info = tarfile.TarInfo("lineage/nb.ipynb")
        info.size = 1
        tar.addfile(info, io.BytesIO(b"x"))
    assert "notebook" in str(staging.archive_problem("db.tar.gz", tar_buffer.getvalue()))
    assert "unreadable" in str(staging.archive_problem("broken.zip", b"not a zip"))


def test_verification_catches_a_file_added_after_staging(synthetic: Synthetic) -> None:
    dest = synthetic.staged / UUID
    data = staging.stage_capsule(synthetic.zip_path, dest)
    staging.verify_staged(dest)
    (data / "solution.ipynb").write_text("{}")
    with pytest.raises(staging.IntegrityError, match="notebook"):
        staging.verify_staged(dest)
    (data / "solution.ipynb").unlink()
    (data / "extra.csv").write_text("a\n1\n")
    with pytest.raises(staging.IntegrityError, match="differ from the manifest"):
        staging.verify_staged(dest)
    # A reused staging is verified again, so the tampering also stops `stage_capsule`.
    with pytest.raises(staging.IntegrityError):
        staging.stage_capsule(synthetic.zip_path, dest)
    (data / "extra.csv").unlink()
    (data / "link").symlink_to(synthetic.hub / "BixBench.jsonl")
    with pytest.raises(staging.IntegrityError, match="symbolic link"):
        staging.verify_staged(dest)


def test_leak_scan_finds_a_secret_in_a_plain_file(synthetic: Synthetic) -> None:
    data = staging.stage_capsule(synthetic.zip_path, synthetic.staged / UUID)
    secrets = [s for q in synthetic.capsule.questions for s in q.long_secrets()]
    assert SENTINELS["hypothesis"] in secrets and SENTINELS["canary"] in secrets
    assert staging.leak_scan(data, secrets) == []
    (data / "nested" / "meta.txt").write_text(f"note: {SENTINELS['hypothesis']}\n")
    assert staging.leak_scan(data, secrets) == ["nested/meta.txt"]


def test_a_zip_without_data_is_refused(tmp_path: Path) -> None:
    path = tmp_path / "CapsuleFolder-empty.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("CapsuleNotebook-x/nb.ipynb", "{}")
    with pytest.raises(staging.IntegrityError, match="no data files"):
        staging.stage_capsule(path, tmp_path / "staged")
