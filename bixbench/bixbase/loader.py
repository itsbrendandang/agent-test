"""Study/task loader for BixBench v1 (futurehouse/BixBench) style benchmarks.

A Study = one capsule (a published analysis rebuilt from raw data) with one or
more questions. Each Question carries its `ideal` target answer and an
`eval_mode` for the grader.

Sources supported:
  - "hf" or a HF dataset id (default futurehouse/BixBench): question rows from
    the dataset; per-capsule data zips downloaded from the same repo via
    hf_hub_download and prepared like the official harness: unzip, hoist the
    "Data" dir contents, delete "Notebook" dir + *.ipynb so the agent never
    sees the reference solution. On top of the official prep, rendered
    reports and scripts (STRIP_SUFFIXES) are deleted too.
  - a local directory: a questions table (questions.{jsonl,csv,parquet} or any
    single table file) plus capsule dirs/zips.

Expected table columns (official schema): question, ideal, distractors,
capsule_uuid, short_id, question_id, data_folder, eval_mode.
"""

from __future__ import annotations

import json
import os
import shutil
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

HF_DATASET_ID = "futurehouse/BixBench"
HF_ZIP_REPO_ID = "futurehouse/bixbench"

REQUIRED_COLS = {"question", "ideal"}

# Files that can carry the reference analysis: notebooks (official prep) plus
# rendered reports and scripts. Compared case-insensitively.
STRIP_SUFFIXES = frozenset(
    {".ipynb", ".rmd", ".qmd", ".html", ".htm", ".r", ".py", ".sh"}
)
# Written last into a prepared data dir; a dir without it is never reused.
PREPARED_MARKER = ".bixbase-prepared"
_PREP_VERSION = "2"
_prep_locks: dict[str, threading.Lock] = {}
_prep_locks_guard = threading.Lock()


@dataclass
class Question:
    question_id: str
    text: str
    ideal: str
    distractors: list[str] = field(default_factory=list)
    eval_mode: str = "llm_verifier"  # per official defaults for open-answer
    metadata: dict = field(default_factory=dict)


@dataclass
class Study:
    study_id: str
    data_folder: str  # zip filename or subdir name
    questions: list[Question]
    metadata: dict = field(default_factory=dict)
    _data_dir: Path | None = field(default=None, repr=False)

    @property
    def data_dir(self) -> Path:
        if self._data_dir is None:
            raise RuntimeError(
                f"study {self.study_id} data not prepared; call prepare_data()"
            )
        return self._data_dir

    def describe(self) -> str:
        return self.metadata.get("data_description", "")


# ---------------------------------------------------------------------------


def load_studies(
    source: str = "hf",
    cache_dir: Path = Path("data"),
    only: Iterable[str] | None = None,
) -> list[Study]:
    """Load all studies, optionally filtered to `only` study ids."""
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    if source in ("hf", HF_DATASET_ID, "futurehouse/bixbench"):
        studies = _load_from_hf(cache_dir)
    else:
        studies = _load_from_dir(Path(source), cache_dir)
    if only:
        wanted = set(only)
        studies = [s for s in studies if s.study_id in wanted]
        missing = wanted - {s.study_id for s in studies}
        if missing:
            raise KeyError(
                f"study ids not found: {sorted(missing)}. "
                f"available: {sorted(_all_ids(source, cache_dir))}"
            )
    if not studies:
        raise RuntimeError(f"no studies loaded from {source!r}")
    return studies


def _all_ids(source: str, cache_dir: Path) -> list[str]:
    try:
        if source in ("hf", HF_DATASET_ID, "futurehouse/bixbench"):
            return [s.study_id for s in _load_from_hf(cache_dir)]
        return [s.study_id for s in _load_from_dir(Path(source), cache_dir)]
    except Exception:  # noqa: BLE001
        return []


# -- HF source ----------------------------------------------------------------


def _load_from_hf(cache_dir: Path) -> list[Study]:
    from datasets import load_dataset

    ds = load_dataset(HF_DATASET_ID, split="train")
    return _studies_from_rows(ds.to_list(), cache_dir, source="hf")


# -- local dir source -----------------------------------------------------------


def _load_from_dir(root: Path, cache_dir: Path) -> list[Study]:
    if not root.is_dir():
        raise FileNotFoundError(f"data source {root} is not a directory")
    rows = _read_question_table(root)
    studies = _studies_from_rows(rows, cache_dir, source=str(root))
    # resolve data lazily at run time via prepare_study_data, but set the
    # source dir so it can find capsule dirs/zips next to the question table
    for s in studies:
        s.metadata["source_dir"] = str(root.resolve())
    return studies


def _read_question_table(root: Path) -> list[dict]:
    """Find and read the questions table in an organizers' dir layout."""
    import pandas as pd

    preferred = [
        root / "questions.jsonl",
        root / "questions.csv",
        root / "questions.parquet",
        root / "BixBench.jsonl",
        root / "BixBench.csv",
        root / "BixBench.parquet",
        # kept from the first version of this file (misnamed; this is v1)
        root / "bixbench3.jsonl",
        root / "bixbench3.csv",
        root / "bixbench3.parquet",
    ]
    candidates = preferred + sorted(
        p
        for p in root.iterdir()
        if p.suffix in {".jsonl", ".csv", ".parquet"} and p not in preferred
    )
    for path in candidates:
        if not path.is_file():
            continue
        if path.suffix == ".jsonl":
            rows = [
                json.loads(line)
                for line in path.read_text().splitlines()
                if line.strip()
            ]
        elif path.suffix == ".csv":
            rows = pd.read_csv(path).to_dict("records")
        else:
            rows = pd.read_parquet(path).to_dict("records")
        if rows and REQUIRED_COLS <= set(rows[0]):
            return rows
    raise FileNotFoundError(
        f"no question table found in {root}. Looked for a .jsonl/.csv/.parquet "
        f"file containing columns {sorted(REQUIRED_COLS)}; found files: "
        f"{[p.name for p in root.iterdir()]}"
    )


# -- shared ---------------------------------------------------------------------


def _studies_from_rows(rows: list[dict], cache_dir: Path, source: str) -> list[Study]:
    import pandas as pd

    by_capsule: dict[str, list[dict]] = {}
    for row in rows:
        row = {
            k: (None if isinstance(v, float) and pd.isna(v) else v)
            for k, v in row.items()
        }
        key = row.get("capsule_uuid") or row.get("data_folder") or "unknown"
        by_capsule.setdefault(key, []).append(row)

    studies = []
    seen_ids: dict[str, int] = {}
    for capsule_uuid, qrows in by_capsule.items():
        first = qrows[0]
        study_id = first.get("short_id") or capsule_uuid
        # short_id is not guaranteed unique (e.g. six capsules share bix-61);
        # suffix duplicates so run dirs never collide
        if study_id in seen_ids:
            seen_ids[study_id] += 1
            study_id = f"{study_id}-{capsule_uuid[:8]}"
        else:
            seen_ids[study_id] = 1
        questions = [
            Question(
                question_id=r.get("question_id") or f"{study_id}-q{i+1}",
                text=r["question"],
                ideal=str(r["ideal"]),
                distractors=list(r.get("distractors") or []),
                eval_mode=r.get("eval_mode") or "llm_verifier",
                metadata={
                    k: r.get(k)
                    for k in ("categories", "paper", "hypothesis", "result")
                    if r.get(k) is not None
                },
            )
            for i, r in enumerate(qrows)
        ]
        study = Study(
            study_id=study_id,
            data_folder=first.get("data_folder") or "",
            questions=questions,
            metadata={
                "capsule_uuid": capsule_uuid,
                "source": source,
                "categories": first.get("categories"),
                "paper": first.get("paper"),
            },
        )
        studies.append(study)
    return studies


def _ensure_zip(zip_filename: str, cache_dir: Path) -> Path:
    """Download capsule zip from HF (dataset repo) if not cached."""
    from huggingface_hub import hf_hub_download

    if not zip_filename:
        raise ValueError("row has no data_folder; cannot locate capsule data")
    dest = cache_dir / zip_filename
    if dest.is_file():
        return dest
    path = hf_hub_download(
        repo_id=HF_ZIP_REPO_ID,
        filename=zip_filename,
        local_dir=cache_dir,
        repo_type="dataset",
    )
    return Path(path)


def is_prepared(data_dir: Path) -> bool:
    """True when the dir was fully prepared by the current prep rules."""
    try:
        return (data_dir / PREPARED_MARKER).read_text().strip() == _PREP_VERSION
    except OSError:
        return False


def strip_reference_material(root: Path) -> list[str]:
    """Delete Notebook dirs and every file whose suffix is in STRIP_SUFFIXES.
    Returns the removed paths (relative), for the caller to report."""
    removed: list[str] = []
    for nb_dir in [
        p for p in root.rglob("*") if p.is_dir() and "Notebook" in p.name
    ]:
        if nb_dir.exists():
            removed.append(str(nb_dir.relative_to(root)) + "/")
            shutil.rmtree(nb_dir, ignore_errors=True)
    for f in [p for p in root.rglob("*") if p.is_file() or p.is_symlink()]:
        if f.suffix.lower() in STRIP_SUFFIXES:
            removed.append(str(f.relative_to(root)))
            f.unlink()
    return removed


def _prepare_zip(zip_path: Path, cache_dir: Path) -> Path:
    """Official prep: unzip, hoist Data/*, remove Notebook dir + *.ipynb
    (and reports/scripts, see STRIP_SUFFIXES).

    Race-free: everything happens in a private temp dir next to the target,
    the completion marker is written last, and the finished dir appears
    under its final name with one atomic rename. A dir without the marker
    (half-unpacked, or prepared by an older version) is replaced, never used.
    """
    cache_dir = Path(cache_dir)
    extract_dir = (cache_dir / zip_path.stem).resolve()
    with _prep_locks_guard:
        lock = _prep_locks.setdefault(str(extract_dir), threading.Lock())
    with lock:  # one thread per target; other processes: see the rename below
        if is_prepared(extract_dir):
            return extract_dir
        cache_dir.mkdir(parents=True, exist_ok=True)
        tmp_dir = extract_dir.parent / (
            f".prep-{zip_path.stem}-{os.getpid()}-{uuid.uuid4().hex[:8]}"
        )
        tmp_dir.mkdir()
        try:
            shutil.unpack_archive(str(zip_path), str(tmp_dir))

            data_folder = next(
                (p for p in tmp_dir.rglob("*") if p.is_dir() and "Data" in p.name),
                None,
            )
            if data_folder is not None:
                for item in data_folder.iterdir():
                    shutil.move(str(item), str(tmp_dir / item.name))
                shutil.rmtree(data_folder)

            strip_reference_material(tmp_dir)
            (tmp_dir / PREPARED_MARKER).write_text(_PREP_VERSION + "\n")

            if extract_dir.exists():
                # unmarked leftover: move it aside (atomic), delete afterwards
                stale = extract_dir.parent / f"{tmp_dir.name}.stale"
                os.rename(extract_dir, stale)
                shutil.rmtree(stale, ignore_errors=True)
            try:
                os.rename(tmp_dir, extract_dir)
            except OSError:
                # another process finished the same dir first: use theirs
                if not is_prepared(extract_dir):
                    raise
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)
    return extract_dir


def prepare_study_data(study: Study, cache_dir: Path) -> Path:
    """Ensure a study's data dir exists, downloading the capsule zip if needed."""
    if study._data_dir is not None:
        return study._data_dir
    from_hf = study.metadata.get("source") in ("hf", HF_DATASET_ID, HF_ZIP_REPO_ID)
    roots = [Path(cache_dir)]
    if study.metadata.get("source_dir"):
        roots.append(Path(study.metadata["source_dir"]))
    for root in roots:
        # zip on disk: always goes through the marker check in _prepare_zip,
        # so a half-unpacked dir beside it is never picked up
        zip_cand = root / study.data_folder
        if zip_cand.suffix == ".zip" and zip_cand.is_file():
            study._data_dir = _prepare_zip(zip_cand, cache_dir)
            return study._data_dir
        # already-extracted dirs, named by zip stem or study id. Without a
        # marker they are trusted only for a local source with no zip (a dir
        # the user unpacked by hand; it is used as it is, nothing is stripped)
        for cand in (
            root / Path(study.data_folder).stem,
            root / study.data_folder,
            root / study.study_id,
        ):
            if cand == root:  # empty data_folder: never the whole cache
                continue
            if cand.is_dir() and (is_prepared(cand) or not from_hf):
                study._data_dir = cand.resolve()
                return study._data_dir
    # download from HF (only when this study is actually being run)
    if from_hf:
        zip_path = _ensure_zip(study.data_folder, cache_dir)
        study._data_dir = _prepare_zip(zip_path, cache_dir)
        return study._data_dir
    raise FileNotFoundError(
        f"could not locate data for study {study.study_id} "
        f"(data_folder={study.data_folder!r}) under {cache_dir}"
    )
