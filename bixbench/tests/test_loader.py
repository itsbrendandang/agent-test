"""Item 5: capsule prep is atomic, marked complete, and strips reference
material (notebooks, rendered reports, scripts)."""

import shutil
import threading
import time
import zipfile
from pathlib import Path

from bixbase import loader
from bixbase.loader import PREPARED_MARKER, Study, is_prepared, prepare_study_data

STEM = "CapsuleFolder-abc"
KEEP = {"values.csv", "sub/table.xlsx", "notes.txt", "nested.zip"}
DROP = {"report.html", "analysis.Rmd", "paper.QMD", "sub/script.R",
        "sub/run.py", "do.sh", "sub/inner.ipynb", "page.htm"}


def make_zip(cache: Path) -> Path:
    cache.mkdir(parents=True, exist_ok=True)
    z = cache / f"{STEM}.zip"
    with zipfile.ZipFile(z, "w") as f:
        for name in KEEP | DROP:
            f.writestr(f"CapsuleFolder-abc/CapsuleData-abc/{name}", "x")
        f.writestr("CapsuleFolder-abc/CapsuleNotebook-abc/solution.ipynb", "{}")
        f.writestr("CapsuleFolder-abc/CapsuleNotebook-abc/answers.txt", "x")
        f.writestr("CapsuleFolder-abc/top.ipynb", "{}")
    return z


def study(source="hf") -> Study:
    return Study(study_id="s", data_folder=f"{STEM}.zip", questions=[],
                 metadata={"source": source})


def files(d: Path) -> set[str]:
    return {str(p.relative_to(d)) for p in d.rglob("*") if p.is_file()}


def test_prepare_strips_notebooks_reports_and_scripts(tmp_path):
    cache = tmp_path / "data"
    make_zip(cache)
    d = prepare_study_data(study(), cache)
    assert d == (cache / STEM).resolve() and is_prepared(d)
    left = files(d) - {PREPARED_MARKER}
    assert KEEP <= left
    assert not any(Path(f).suffix.lower() in loader.STRIP_SUFFIXES for f in left)
    assert not any("Notebook" in f or "solution" in f or "answers" in f for f in left)
    assert not list(cache.glob(".prep-*"))               # no temp dir left over


def test_unfinished_dir_is_never_reused(tmp_path):
    cache = tmp_path / "data"
    make_zip(cache)
    half = cache / STEM                                  # as if killed mid-unpack
    (half / "CapsuleNotebook-abc").mkdir(parents=True)
    (half / "CapsuleNotebook-abc" / "solution.ipynb").write_text("{}")
    (half / "values.csv").write_text("half")
    assert not is_prepared(half)
    d = prepare_study_data(study(), cache)
    assert is_prepared(d) and not list(d.rglob("*.ipynb"))
    assert (d / "values.csv").read_text() == "x"
    assert not list(cache.glob(".prep-*"))


def test_hf_study_does_not_trust_an_unmarked_dir_without_zip(tmp_path, monkeypatch):
    cache = tmp_path / "data"
    (cache / STEM).mkdir(parents=True)
    (cache / STEM / "solution.ipynb").write_text("{}")
    src = make_zip(tmp_path / "elsewhere")
    monkeypatch.setattr(loader, "_ensure_zip", lambda name, c: src)  # no download
    d = prepare_study_data(study(), cache)
    assert is_prepared(d) and not list(d.rglob("*.ipynb"))


def test_local_hand_unpacked_dir_is_still_used_as_is(tmp_path):
    cache = tmp_path / "data"
    (cache / "s").mkdir(parents=True)
    (cache / "s" / "values.csv").write_text("x")
    st = Study(study_id="s", data_folder="", questions=[],
               metadata={"source": str(tmp_path)})
    assert prepare_study_data(st, cache) == (cache / "s").resolve()


def test_parallel_repeats_never_see_a_dir_being_unpacked(tmp_path, monkeypatch):
    cache = tmp_path / "data"
    make_zip(cache)
    final = cache / STEM
    real_unpack = shutil.unpack_archive
    calls, seen_early = [], []

    def slow_unpack(src, dst, *a, **k):
        calls.append(dst)
        real_unpack(src, dst, *a, **k)
        time.sleep(0.4)                                  # notebooks are on disk now
        seen_early.append(final.exists())

    monkeypatch.setattr(loader.shutil, "unpack_archive", slow_unpack)
    results, errors = [], []
    start = threading.Barrier(8)

    def repeat():
        try:
            start.wait()
            d = prepare_study_data(study(), cache)
            # what a repeat would hand to the sandbox, checked the moment it gets it
            results.append((is_prepared(d), [p.name for p in d.rglob("*.ipynb")],
                            (d / "values.csv").is_file()))
        except Exception as e:  # noqa: BLE001
            errors.append(e)

    threads = [threading.Thread(target=repeat) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert not errors, errors
    assert results == [(True, [], True)] * 8
    assert len(calls) == 1                               # unpacked once
    assert seen_early == [False]                         # final name appears only when done
    assert not list(cache.glob(".prep-*"))
