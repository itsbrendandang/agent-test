"""The integrity boundary, part 1: what a capsule zip may put into /data."""

from __future__ import annotations

import gzip
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
        ("CapsuleData-x/GCF_000005845.2_ASM584v2_genomic.fna.amb", False),
        ("CapsuleData-x/1038775at2759.faa.mafft.clipkit.treefile", False),
        ("CapsuleData-x/Fungi_Ncra.busco.zip", False),  # opened by archive_problem
        ("CapsuleData-x/db.tar.gz", False),
        # The folder must be exactly the one the dataset names, where the dataset puts it.
        ("SolutionData/answer_key.csv", True),
        ("CapsuleData-y/counts.csv", True),
        ("CapsuleData-x-extra/counts.csv", True),
        ("MyData/CapsuleData-x/counts.csv", True),
        ("CapsuleFolder-y/CapsuleData-x/counts.csv", True),
        ("CapsuleData-x", True),
        # Types that are not data files of v1.5 are withheld, whatever they are.
        ("CapsuleData-x/figure_volcano.png", True),
        ("CapsuleData-x/run_analysis.sh", True),
        ("CapsuleData-x/analysis.Rout", True),
        ("CapsuleData-x/analysis.log", True),
        ("CapsuleData-x/session.RData", True),
        ("CapsuleData-x/.Rhistory", True),
        ("CapsuleData-x/report.rtf", True),
        ("CapsuleData-x/report.tex", True),
        ("CapsuleData-x/slides.pptx", True),
        ("CapsuleData-x/report.doc", True),
        ("CapsuleData-x/report.odt", True),
        ("CapsuleData-x/report.rst", True),
        ("CapsuleData-x/executed_nb.json", True),
        ("CapsuleData-x/bundle.7z", True),
        ("CapsuleData-x/bundle.tar.bz2", True),
        ("CapsuleData-x/bundle.tar.xz", True),
        ("CapsuleData-x/bundle.dat", True),
        ("CapsuleData-x/README", True),
        # A forbidden type hidden behind another suffix.
        ("CapsuleData-x/solution.ipynb.gz", True),
        ("CapsuleData-x/analysis.ipynb.txt", True),
        ("CapsuleData-x/solve.py.txt", True),
        ("CapsuleData-x/table.csv.bz2", True),
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
    assert (staging.exclusion_reason(member, "CapsuleData-x") is not None) is excluded


def test_staging_is_an_allow_list_of_data_file_types() -> None:
    # Everything a v1.5 data folder holds today is on the list...
    for suffix in ("xlsx xls csv tsv txt rds h5ad gmt faa fna fastq bam vcf treefile clipkit "
                   "mafft amb ann bwt fai pac sa").split():  # fmt: skip
        assert staging.file_type_problem(f"dir/sample.{suffix}") is None, suffix
    assert staging.file_type_problem("reads_1.fastq.gz") is None
    # ...and a type nobody listed is withheld with a reason that says so (never silently).
    for name in ("notes.dat", "plot.svg", "model.pkl", "x.parquet", "Makefile"):
        assert str(staging.file_type_problem(name)).startswith(staging.NOT_LISTED), name
    # Tool-output types are data only inside an archive, never loose in the data folder.
    for name in ("run/hmmer_output/1at2759.out", "x.faa.mafft.clipkit.iqtree", "info/species.info",
                 "lineages/eukaryota_odb10/lengths_cutoff", "short_summary.json", ".checkpoint"):  # fmt: skip
        assert staging.file_type_problem(name, in_archive=True) is None, name
        assert staging.file_type_problem(name) is not None, name
    assert staging.file_type_problem("lineages/odb10/notes", in_archive=True) is not None
    assert staging.data_folder_for("CapsuleFolder-abc.zip") == "CapsuleData-abc"
    with pytest.raises(staging.IntegrityError):
        staging.data_folder_for("SomethingElse.zip")


def _zip(names: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in names.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def test_a_hostile_capsule_stages_only_its_data(tmp_path: Path) -> None:
    """The red-team's capsule (/tmp/bbx/slip.py): every way it found to slip a write-up past
    the old suffix deny-list."""
    secret = SENTINELS["hypothesis"]
    notebook = json.dumps({"cells": [{"source": secret}], "nbformat": 4}).encode()
    folder = "CapsuleData-x/"
    hostile = {
        "solution.ipynb.gz": gzip.compress(notebook),
        "executed_nb.json": notebook,
        "analysis.ipynb.txt": notebook,
        "renamed_nb.txt": notebook,  # notebook JSON under a data suffix
        "figure_volcano.png": b"\x89PNG fake",
        "run_analysis.sh": b"Rscript x.R\n",
        "analysis.Rout": b"[1] 42\n",
        "analysis.log": b"answer 42",
        "session.RData": gzip.compress(secret.encode()),
        ".Rhistory": b"mean(x)\n",
        "report.rtf": secret.encode(),
        "report.tex": secret.encode(),
        "slides.pptx": _zip({"ppt/slide1.xml": secret.encode()}),
        "report.doc": secret.encode(),
        "report.odt": _zip({"content.xml": secret.encode()}),
        "report.rst": secret.encode(),
        "bundle.7z": b"7z\xbc\xaf'\x1c" + notebook,
        "bundle.dat": _zip({"nb.ipynb": notebook}),
        "bundle.csv": _zip({"nb.ipynb": notebook}),  # a zip under a data suffix
        "packed.txt": gzip.compress(secret.encode()),  # a gzip under a data suffix
        "scripts.zip": _zip({"solve.py": b"x", "out.txt": b"x"}),
        "docs.zip": _zip({"README.md": b"x"}),
        "code.zip": _zip({"analysis.Rmd": b"x"}),
        "odd.zip": _zip({"data/answers.pkl": b"x"}),
        "deep.zip": _zip({"inner.zip": _zip({"x/solve.R": b"x"})}),
        "analysis.ipynb": notebook,
        "x.Rmd": notebook,
        "x.html": notebook,
        "x.py": notebook,
        "x.md": notebook,
    }
    path = tmp_path / "CapsuleFolder-x.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(folder + "counts.csv", "a\n1\n")
        archive.writestr(folder + "busco.zip", _zip({"run/full_table.tsv": b"x", "a.faa": b"x"}))
        for name, content in hostile.items():
            archive.writestr(folder + name, content)
        archive.writestr("SolutionData/answer_key.csv", secret)
        archive.writestr("CapsuleNotebook-x/nb.ipynb", notebook)
    manifest = staging.plan(path)
    assert manifest.paths == {"counts.csv", "busco.zip"}
    withheld = {e["member"].removeprefix(folder): e["reason"] for e in manifest.excluded}
    assert set(hostile) <= set(withheld)
    assert withheld["SolutionData/answer_key.csv"] == "outside the capsule's data folder"
    assert withheld["bundle.csv"] == "zip container under a non-archive name"
    assert withheld["packed.txt"] == "gzip stream under an uncompressed name"
    assert withheld["renamed_nb.txt"] == "notebook content under a data file name"
    assert "analysis script" in withheld["scripts.zip"] and "solve.py" in withheld["scripts.zip"]
    assert "rendered report" in withheld["docs.zip"] and "notebook" in withheld["code.zip"]
    assert staging.NOT_LISTED in withheld["odd.zip"] and "solve.R" in withheld["deep.zip"]
    # What was withheld only for its type is listed for a person to review, by name.
    listed = {e["member"].removeprefix(folder) for e in manifest.not_listed}
    assert {"figure_volcano.png", "session.RData", "report.rtf", "bundle.dat"} <= listed
    data = staging.stage_capsule(path, tmp_path / "staged")
    assert _files(data) == {"counts.csv", "busco.zip"}
    assert staging.leak_scan(data, [secret]) == []


def test_a_staging_made_under_older_rules_is_redone(synthetic: Synthetic) -> None:
    dest = synthetic.staged / UUID
    data = staging.stage_capsule(synthetic.zip_path, dest)
    manifest_file = dest / "manifest.json"
    old = json.loads(manifest_file.read_text())
    assert old["rules_version"] == staging.RULES_VERSION
    assert old["data_folder"] == f"CapsuleData-{UUID}"
    # A manifest from before the allow-list, with a file those rules had let through.
    del old["rules_version"], old["data_folder"]
    old["included"].append({"member": "x", "path": "figure.png", "bytes": 1})
    manifest_file.write_text(json.dumps(old))
    (data / "figure.png").write_bytes(b"x")
    assert _files(staging.stage_capsule(synthetic.zip_path, dest)) == {
        "counts.csv",
        "nested/meta.txt",
        "results.busco.zip",
    }


def test_nested_archives_are_inspected() -> None:
    def zipped(names: list[str]) -> bytes:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            for name in names:
                archive.writestr(name, "x")
        return buffer.getvalue()

    assert staging.archive_problem("ok.zip", zipped(["a/b.faa", "run/log.txt"])) is None
    assert "analysis script" in str(staging.archive_problem("bad.zip", zipped(["a/solve.py"])))
    assert staging.NOT_LISTED in str(staging.archive_problem("bad.zip", zipped(["a/fig.png"])))
    assert "unsafe" in str(staging.archive_problem("bad.zip", zipped(["../up.csv"])))
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
    # Re-cased, re-wrapped, inside an xlsx (a zip), gzipped, or past the size cap of a table.
    secret = SENTINELS["hypothesis"]
    (data / "nested" / "meta.txt").write_text("samples: 2\n")
    (data / "lower.txt").write_text(secret.lower())
    (data / "wrapped.txt").write_text(secret.replace(" ", "\n  "))
    (data / "writeup.xlsx").write_bytes(_zip({"xl/sharedStrings.xml": secret.encode()}))
    (data / "table.csv.gz").write_bytes(gzip.compress(secret.encode()))
    with (data / "big.txt").open("wb") as handle:
        handle.write(b"x" * (staging.LEAK_SCAN_MAX_BYTES + 1) + secret.encode())
    assert staging.leak_scan(data, secrets) == [
        "big.txt",
        "lower.txt",
        "table.csv.gz",
        "wrapped.txt",
        "writeup.xlsx",
    ]


def test_a_zip_without_data_is_refused(tmp_path: Path) -> None:
    path = tmp_path / "CapsuleFolder-empty.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("CapsuleNotebook-x/nb.ipynb", "{}")
    with pytest.raises(staging.IntegrityError, match="no data files"):
        staging.stage_capsule(path, tmp_path / "staged")
