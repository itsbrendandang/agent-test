"""Turn a capsule zip into the read-only /data directory of the sandbox.

A capsule zip holds a `CapsuleData-<uuid>` folder (the inputs) and usually a
`CapsuleNotebook-<uuid>` folder with the executed solution notebook. A few zips also carry
executed notebooks inside the data folder. Staging is an allow-list on three things:

  * the folder: only members of the folder named exactly `CapsuleData-<uuid>`, the uuid being
    the one the dataset gives for the capsule (not any folder with "Data" in its name);
  * the file type: only the data file types listed in `DATA_SUFFIXES` (what the v1.5 capsules
    hold), optionally gzipped, and zip / tar.gz archives;
  * inside an archive, at any depth: only those types plus the tool-output types of
    `ARCHIVE_ONLY_SUFFIXES` (BUSCO runs, lineage databases, IQ-TREE output).

Everything else is left in the zip and listed in the manifest with the reason. A type that is
not on the list is never dropped silently: the manifest says "file type not on the allow-list"
and `bixbench-v1 audit` counts it as a problem to review.

The official harness (bixbench/generate_trajectories.py) uses a deny-list: it moves the data
folder's contents up, deletes the first folder with "Notebook" in its name and deletes
top-level *.ipynb files.

`verify_staged` is run before every solver run, not only after staging, so a file added to a
staged folder later is caught.

What the allow-list cannot do: tell a table of inputs from a table of answers. A write-up saved
as .txt or .csv passes the type rule; `leak_scan` is the backstop for those.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import shutil
import tarfile
import zipfile
import zlib
from collections.abc import Iterator
from dataclasses import asdict, dataclass, field
from pathlib import Path, PurePosixPath

MANIFEST = "manifest.json"
DATA_DIR = "data"
# Bump when the rules below change: a staging made under older rules is redone, not reused.
RULES_VERSION = 2
DATA_FOLDER_PREFIX = "CapsuleData-"
ZIP_PREFIX = "CapsuleFolder-"
# Every file type the 64 zips of v1.5 hold in a data folder (bixbench-v1 audit, names only).
DATA_SUFFIXES = frozenset(
    {
        ".xlsx", ".xls", ".csv", ".tsv", ".txt", ".rds", ".h5ad", ".gmt",  # tables, objects
        ".faa", ".fna", ".fastq", ".bam", ".vcf",  # sequences, alignments, variants
        ".amb", ".ann", ".bwt", ".fai", ".pac", ".sa",  # bwa / samtools indexes
        ".mafft", ".clipkit", ".treefile",  # alignments, trimmed alignments, trees
    }
)  # fmt: skip
# Also accepted inside an archive: what BUSCO, HMMER and IQ-TREE write next to their results.
ARCHIVE_ONLY_SUFFIXES = frozenset(
    {
        ".out", ".hmm", ".prfl", ".log", ".ckp", ".model", ".iqtree", ".mldist", ".bionj",
        ".json", ".checkpoint", ".info", ".cfg", ".md5", ".ratio",
    }
)  # fmt: skip
# Files without a suffix in a BUSCO lineage database. No other bare name is accepted.
ARCHIVE_BARE_NAMES = frozenset({"lengths_cutoff", "scores_cutoff", "ancestral", "ancestral_variants"})
NOTEBOOK_SUFFIXES = frozenset({".ipynb", ".rmd", ".qmd"})
REPORT_SUFFIXES = frozenset({".html", ".htm", ".pdf", ".md", ".docx", ".nbconvert"})
SCRIPT_SUFFIXES = frozenset({".py", ".r", ".jl"})
ARCHIVE_SUFFIXES = (".zip", ".tar.gz")
SKIPPED_NAMES = frozenset({".ds_store", "thumbs.db"})
MAX_ARCHIVE_DEPTH = 3
NOT_LISTED = "file type not on the allow-list"
# Files up to this size are searched whole, and inside if they are a zip (xlsx) or gzip.
# Larger plain-text tables are searched as a stream; larger binaries are not searched.
LEAK_SCAN_MAX_BYTES = 5_000_000
STREAMED_SUFFIXES = (".txt", ".csv", ".tsv")
_ZIP_MAGIC = b"PK\x03\x04"
_GZIP_MAGIC = b"\x1f\x8b"
_ZIP_NAMES = (".zip", ".xlsx")
_GZIP_NAMES = (".gz", ".rds", ".bam")  # R objects and BAM are gzip streams by format


class IntegrityError(RuntimeError):
    """The sandbox would see something it must not. The run is refused."""


@dataclass
class Manifest:
    zip_name: str
    zip_sha256: str
    included: list[dict[str, object]] = field(default_factory=list)  # path, bytes
    excluded: list[dict[str, str]] = field(default_factory=list)  # member, reason
    data_folder: str = ""
    rules_version: int = 0

    @property
    def paths(self) -> set[str]:
        return {str(item["path"]) for item in self.included}

    @property
    def not_listed(self) -> list[dict[str, str]]:
        """Members of the data folder withheld only because their type is not on the list:
        the ones a person should look at (a new data type, or a write-up)."""
        return [e for e in self.excluded if e["reason"].startswith(NOT_LISTED)]


def data_folder_for(zip_name: str) -> str:
    """`CapsuleData-<uuid>` for the dataset's `CapsuleFolder-<uuid>.zip`."""
    stem = PurePosixPath(zip_name).name.removesuffix(".zip")
    if not stem.startswith(ZIP_PREFIX) or stem == ZIP_PREFIX:
        raise IntegrityError(f"{zip_name}: not a capsule zip name ({ZIP_PREFIX}<uuid>.zip)")
    return DATA_FOLDER_PREFIX + stem.removeprefix(ZIP_PREFIX)


def file_type_problem(name: str, in_archive: bool = False) -> str | None:
    """Why a file's name is not an accepted data file, or None if it is.

    Every dotted part of the name is checked, so `solution.ipynb.gz` and `analysis.ipynb.txt`
    are notebooks. One trailing `.gz` is looked through. Archives pass here and are opened by
    `archive_problem`."""
    lowered = PurePosixPath(name.lower())
    base = lowered.name
    if any("notebook" in part for part in lowered.parts):
        return "notebook folder or notebook file"
    parts = [f".{part}" for part in base.split(".")[1:] if part]
    for forbidden, reason in (
        (NOTEBOOK_SUFFIXES, "notebook file"),
        (REPORT_SUFFIXES, "rendered report or write-up"),
        (SCRIPT_SUFFIXES, "analysis script"),
    ):
        if any(part in forbidden for part in parts):
            return reason
    if base.endswith(ARCHIVE_SUFFIXES):
        return None
    if parts and parts[-1] == ".gz":
        parts = parts[:-1]
    if not parts:
        if in_archive and base in ARCHIVE_BARE_NAMES:
            return None
        return f"{NOT_LISTED} (no suffix)"
    allowed = DATA_SUFFIXES | ARCHIVE_ONLY_SUFFIXES if in_archive else DATA_SUFFIXES
    return None if parts[-1] in allowed else f"{NOT_LISTED} ({parts[-1]})"


def _data_index(parts: tuple[str, ...], data_folder: str) -> int | None:
    """Where the data folder sits in a member path: first, or directly under the zip's own
    wrapper folder `CapsuleFolder-<uuid>`. Anywhere else, or any other name, is not it."""
    wrapper = ZIP_PREFIX + data_folder.removeprefix(DATA_FOLDER_PREFIX)
    if len(parts) > 1 and parts[0] == data_folder:
        return 0
    if len(parts) > 2 and parts[0] == wrapper and parts[1] == data_folder:
        return 1
    return None


def exclusion_reason(member: str, data_folder: str) -> str | None:
    """Why a zip member is not staged, or None if it is an input file.

    `member` is the path inside the zip, `data_folder` the exact folder name the dataset
    implies for this capsule. Checked on names only; `plan` also looks at the first bytes and
    inside nested archives."""
    parts = PurePosixPath(member).parts
    lowered = [part.lower() for part in parts]
    if member.startswith("/") or ".." in parts or not parts:
        return "unsafe path"
    if "__macosx" in lowered or lowered[-1] in SKIPPED_NAMES or lowered[-1].startswith("._"):
        return "operating-system metadata"
    if any("notebook" in part for part in lowered):
        return "notebook folder or notebook file"
    index = _data_index(parts, data_folder)
    if index is None:
        return "outside the capsule's data folder"
    return file_type_problem(str(PurePosixPath(*parts[index + 1 :])))


def staged_path(member: str, data_folder: str) -> str:
    """Path under /data: the member's path below the data folder (the official flattening)."""
    parts = PurePosixPath(member).parts
    index = _data_index(parts, data_folder)
    if index is None:
        raise IntegrityError(f"{member}: not under {data_folder}")
    return str(PurePosixPath(*parts[index + 1 :]))


def content_problem(name: str, head: bytes) -> str | None:
    """Why a file's first bytes contradict its name: a container or a notebook under a data
    file's name (`bundle.csv` that is a zip, `table.txt` that is notebook JSON)."""
    lowered = name.lower()
    if head.startswith(_ZIP_MAGIC) and not lowered.endswith(_ZIP_NAMES):
        return "zip container under a non-archive name"
    if head.startswith(_GZIP_MAGIC) and not lowered.endswith(_GZIP_NAMES):
        return "gzip stream under an uncompressed name"
    if head.lstrip()[:1] == b"{" and (b'"cells"' in head or b'"nbformat"' in head):
        return "notebook content under a data file name"
    return None


def _inner_names(name: str, payload: bytes) -> list[tuple[str, bytes | None]]:
    """(member name, bytes if it is itself an archive) for a nested zip or tar.gz."""
    out: list[tuple[str, bytes | None]] = []
    lowered = name.lower()
    if lowered.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            for info in archive.infolist():
                if info.is_dir():
                    continue
                nested = info.filename.lower().endswith(ARCHIVE_SUFFIXES)
                out.append((info.filename, archive.read(info) if nested else None))
    else:
        with tarfile.open(fileobj=io.BytesIO(payload)) as archive:
            for member in archive:
                if member.isdir():
                    continue
                if not member.isfile():
                    raise ValueError(f"{member.name}: link or device in a tar archive")
                nested = member.name.lower().endswith(ARCHIVE_SUFFIXES)
                handle = archive.extractfile(member) if nested else None
                out.append((member.name, handle.read() if handle else None))
    return out


def archive_problem(name: str, payload: bytes, depth: int = 0) -> str | None:
    """Why a nested archive is not staged: one of its members, at any depth, is not an accepted
    type (a notebook, report, script, or anything not on the archive allow-list), or it cannot
    be read (fail closed). Input capsules do carry archives: BUSCO results, lineage databases."""
    if depth >= MAX_ARCHIVE_DEPTH:
        return "archive nested too deeply to inspect"
    try:
        members = _inner_names(name, payload)
    except Exception as error:
        return f"unreadable archive ({type(error).__name__})"
    for inner, inner_payload in members:
        parts = PurePosixPath(inner).parts
        if inner.startswith("/") or ".." in parts:
            return f"archive contains an unsafe path ({inner})"
        lowered = [part.lower() for part in parts]
        if "__macosx" in lowered or lowered[-1] in SKIPPED_NAMES or lowered[-1].startswith("._"):
            continue  # inert metadata a Mac adds when zipping
        problem = file_type_problem(inner, in_archive=True)
        if problem:
            kind = {
                "notebook folder or notebook file": "a notebook",
                "notebook file": "a notebook",
                "rendered report or write-up": "a rendered report",
                "analysis script": "an analysis script",
            }.get(problem, "a " + problem)
            return f"archive contains {kind} ({inner})"
        if inner_payload is not None:
            problem = archive_problem(inner, inner_payload, depth + 1)
            if problem:
                return problem
    return None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def plan(zip_path: Path, data_folder: str | None = None) -> Manifest:
    """Decide, without writing anything, what would be staged from a capsule zip.
    `data_folder` defaults to the folder the zip's own name implies."""
    data_folder = data_folder or data_folder_for(zip_path.name)
    manifest = Manifest(
        zip_path.name, _sha256(zip_path), data_folder=data_folder, rules_version=RULES_VERSION
    )
    seen: set[str] = set()
    with zipfile.ZipFile(zip_path) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            reason = exclusion_reason(info.filename, data_folder)
            if reason is None and (info.external_attr >> 16) & 0o170000 == 0o120000:
                reason = "symbolic link"
            if reason is None and info.filename.lower().endswith(ARCHIVE_SUFFIXES):
                reason = archive_problem(info.filename, archive.read(info))
            elif reason is None:
                with archive.open(info) as handle:
                    reason = content_problem(info.filename, handle.read(4096))
            if reason is None and staged_path(info.filename, data_folder) in seen:
                reason = "duplicate path after flattening"
            if reason is not None:
                manifest.excluded.append({"member": info.filename, "reason": reason})
                continue
            seen.add(staged_path(info.filename, data_folder))
            manifest.included.append(
                {
                    "member": info.filename,
                    "path": staged_path(info.filename, data_folder),
                    "bytes": info.file_size,
                }
            )
    return manifest


def _load_manifest(manifest_file: Path) -> Manifest:
    raw = json.loads(manifest_file.read_text(encoding="utf-8"))
    names = Manifest.__dataclass_fields__
    return Manifest(**{name: value for name, value in raw.items() if name in names})


def stage_capsule(
    zip_path: Path, dest: Path, force: bool = False, data_folder: str | None = None
) -> Path:
    """Extract the allow-listed members of `zip_path` into `dest/data`; write `dest/manifest.json`
    next to it (outside /data). Returns the data directory. Reuses an existing staging whose
    manifest matches the zip, the data folder and the current rules, after re-verifying it."""
    data_folder = data_folder or data_folder_for(zip_path.name)
    data_dir = dest / DATA_DIR
    manifest_file = dest / MANIFEST
    if manifest_file.exists() and not force:
        old = _load_manifest(manifest_file)
        if (old.zip_sha256, old.rules_version, old.data_folder) == (
            _sha256(zip_path),
            RULES_VERSION,
            data_folder,
        ):
            verify_staged(dest)
            return data_dir
    manifest = plan(zip_path, data_folder)
    if not manifest.included:
        raise IntegrityError(f"{zip_path.name}: no data files found to stage")
    if dest.exists():
        shutil.rmtree(dest)
    data_dir.mkdir(parents=True)
    with zipfile.ZipFile(zip_path) as archive:
        for item in manifest.included:
            target = (data_dir / str(item["path"])).resolve()
            if not target.is_relative_to(data_dir.resolve()):
                raise IntegrityError(f"{zip_path.name}: member escapes the data directory")
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(str(item["member"])) as source, target.open("wb") as sink:
                shutil.copyfileobj(source, sink, 1 << 20)
    manifest_file.write_text(json.dumps(asdict(manifest), indent=2), encoding="utf-8")
    verify_staged(dest)
    return data_dir


def verify_staged(dest: Path) -> Manifest:
    """Raise unless `dest/data` holds exactly the manifest's files and each is an accepted type."""
    manifest_file = dest / MANIFEST
    data_dir = dest / DATA_DIR
    if not manifest_file.exists() or not data_dir.is_dir():
        raise IntegrityError(f"{dest}: not a staged capsule (no manifest or no data directory)")
    manifest = _load_manifest(manifest_file)
    found: set[str] = set()
    for path in data_dir.rglob("*"):
        if path.is_symlink():
            raise IntegrityError(f"{path}: symbolic link in staged data")
        if path.is_dir():
            continue
        relative = path.relative_to(data_dir).as_posix()
        # Re-check the name against the allow-list: catches a notebook dropped in later.
        reason = file_type_problem(relative)
        if reason:
            raise IntegrityError(f"{path}: {reason} in staged data")
        found.add(relative)
    if found != manifest.paths:
        extra, missing = sorted(found - manifest.paths), sorted(manifest.paths - found)
        raise IntegrityError(
            f"{dest}: staged files differ from the manifest (unexpected: {extra[:5]}, "
            f"missing: {missing[:5]})"
        )
    return manifest


def _squash(payload: bytes) -> bytes:
    """Lower case, every run of whitespace one space: a secret re-wrapped or re-cased still hits."""
    return re.sub(rb"\s+", b" ", payload.lower())


def _gunzip(payload: bytes, limit: int) -> bytes:
    try:
        return zlib.decompressobj(wbits=31).decompress(payload, limit)
    except zlib.error:
        return b""


def _views(path: Path) -> Iterator[bytes]:
    """The bytes of a small staged file, and what is inside it if it is a zip (xlsx) or gzip."""
    payload = path.read_bytes()
    yield payload
    if payload.startswith(_GZIP_MAGIC):
        yield _gunzip(payload, LEAK_SCAN_MAX_BYTES)
    elif payload.startswith(_ZIP_MAGIC):
        try:
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                for info in archive.infolist():
                    if not info.is_dir() and info.file_size <= LEAK_SCAN_MAX_BYTES:
                        inner = archive.read(info)
                        yield inner
                        if inner.startswith(_GZIP_MAGIC):
                            yield _gunzip(inner, LEAK_SCAN_MAX_BYTES)
        except (zipfile.BadZipFile, OSError, RuntimeError, NotImplementedError):
            return


def _chunks(path: Path, overlap: int) -> Iterator[bytes]:
    """A large file in overlapping windows, so a match across a chunk boundary is not lost."""
    tail = b""
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 22), b""):
            yield tail + chunk
            tail = chunk[-overlap:]


def leak_scan(data_dir: Path, secrets: list[str]) -> list[str]:
    """Staged files that contain one of `secrets`, ignoring case and line wrapping.

    A backstop for write-ups that pass the type rule as plain text. Files up to
    LEAK_SCAN_MAX_BYTES are searched whole and inside (zip containers such as xlsx, gzip);
    larger .txt/.csv/.tsv files are searched as a stream; larger binaries (reads, alignments,
    R objects) are not searched."""
    needles = [_squash(secret.encode("utf-8")).strip() for secret in secrets if secret.strip()]
    hits: list[str] = []
    if not needles:
        return hits
    overlap = 4 * max(len(needle) for needle in needles) + 1024
    for path in sorted(data_dir.rglob("*")):
        if not path.is_file():
            continue
        if path.stat().st_size <= LEAK_SCAN_MAX_BYTES:
            views = _views(path)
        elif path.name.lower().endswith(STREAMED_SUFFIXES):
            views = _chunks(path, overlap)
        else:
            continue
        for view in views:
            squashed = _squash(view)
            if any(needle in squashed for needle in needles):
                hits.append(path.relative_to(data_dir).as_posix())
                break
    return hits
