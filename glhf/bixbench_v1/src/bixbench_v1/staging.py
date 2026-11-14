"""Turn a capsule zip into the read-only /data directory of the sandbox.

A capsule zip holds a `CapsuleData-<uuid>` folder (the inputs) and usually a
`CapsuleNotebook-<uuid>` folder with the executed solution notebook. A few zips also carry
executed notebooks inside the data folder. Staging is an allow-list: a member is copied only if
it sits under the data folder and is not a notebook, a rendered report or an analysis script.
Everything else is left in the zip and listed in the manifest with the reason.

The official harness (bixbench/generate_trajectories.py) does the same with a deny-list: it
moves the data folder's contents up, deletes the first folder with "Notebook" in its name and
deletes top-level *.ipynb files. This module is stricter: see `exclusion_reason`.

`verify_staged` is run before every solver run, not only after staging, so a file added to a
staged folder later is caught.
"""

from __future__ import annotations

import hashlib
import io
import json
import shutil
import tarfile
import zipfile
from dataclasses import asdict, dataclass, field
from pathlib import Path, PurePosixPath

MANIFEST = "manifest.json"
DATA_DIR = "data"
NOTEBOOK_SUFFIXES = frozenset({".ipynb", ".rmd", ".qmd"})
REPORT_SUFFIXES = frozenset({".html", ".htm", ".pdf", ".md", ".docx", ".nbconvert"})
SCRIPT_SUFFIXES = frozenset({".py", ".r", ".jl"})
ARCHIVE_SUFFIXES = (".zip", ".tar", ".tar.gz", ".tgz")
SKIPPED_NAMES = frozenset({".ds_store", "thumbs.db"})
MAX_ARCHIVE_DEPTH = 3
LEAK_SCAN_MAX_BYTES = 5_000_000  # per file; larger files are data matrices, not write-ups


class IntegrityError(RuntimeError):
    """The sandbox would see something it must not. The run is refused."""


@dataclass
class Manifest:
    zip_name: str
    zip_sha256: str
    included: list[dict[str, object]] = field(default_factory=list)  # path, bytes
    excluded: list[dict[str, str]] = field(default_factory=list)  # member, reason

    @property
    def paths(self) -> set[str]:
        return {str(item["path"]) for item in self.included}


def exclusion_reason(member: str) -> str | None:
    """Why a zip member is not staged, or None if it is an input file.

    `member` is the path inside the zip. Checked on names only; `archive_problem` looks inside
    nested archives."""
    parts = PurePosixPath(member).parts
    lowered = [part.lower() for part in parts]
    if member.startswith("/") or ".." in parts:
        return "unsafe path"
    if "__macosx" in lowered or lowered[-1] in SKIPPED_NAMES or lowered[-1].startswith("._"):
        return "operating-system metadata"
    if any("notebook" in part for part in lowered):
        return "notebook folder or notebook file"
    data_index = next((i for i, part in enumerate(parts[:-1]) if "Data" in part), None)
    if data_index is None:
        return "outside the capsule's data folder"
    suffix = PurePosixPath(lowered[-1]).suffix
    if suffix in NOTEBOOK_SUFFIXES:
        return "notebook file"
    if suffix in REPORT_SUFFIXES:
        return "rendered report or write-up"
    if suffix in SCRIPT_SUFFIXES:
        return "analysis script"
    return None


def staged_path(member: str) -> str:
    """Path under /data: the member's path below the data folder (the official flattening)."""
    parts = PurePosixPath(member).parts
    data_index = next(i for i, part in enumerate(parts[:-1]) if "Data" in part)
    return str(PurePosixPath(*parts[data_index + 1 :]))


def _inner_names(name: str, payload: bytes) -> list[tuple[str, bytes | None]]:
    """(member name, bytes if it is itself an archive) for a nested zip or tar."""
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
                if not member.isfile():
                    continue
                nested = member.name.lower().endswith(ARCHIVE_SUFFIXES)
                handle = archive.extractfile(member) if nested else None
                out.append((member.name, handle.read() if handle else None))
    return out


def archive_problem(name: str, payload: bytes, depth: int = 0) -> str | None:
    """Why a nested archive is not staged: it holds a notebook, report or script, or cannot be
    read (fail closed). Input capsules do carry archives (BUSCO results, lineage databases)."""
    if depth >= MAX_ARCHIVE_DEPTH:
        return "archive nested too deeply to inspect"
    try:
        members = _inner_names(name, payload)
    except Exception as error:
        return f"unreadable archive ({type(error).__name__})"
    for inner, inner_payload in members:
        lowered = inner.lower()
        suffix = PurePosixPath(lowered).suffix
        if "notebook" in lowered or suffix in NOTEBOOK_SUFFIXES:
            return f"archive contains a notebook ({inner})"
        # Tool outputs and lineage databases legitimately carry text, logs and config files, so
        # inside an archive only notebooks and rendered reports are refused.
        if suffix in {".html", ".htm", ".pdf", ".docx"}:
            return f"archive contains a rendered report ({inner})"
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


def plan(zip_path: Path) -> Manifest:
    """Decide, without writing anything, what would be staged from a capsule zip."""
    manifest = Manifest(zip_path.name, _sha256(zip_path))
    seen: set[str] = set()
    with zipfile.ZipFile(zip_path) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            reason = exclusion_reason(info.filename)
            if reason is None and (info.external_attr >> 16) & 0o170000 == 0o120000:
                reason = "symbolic link"
            if reason is None and info.filename.lower().endswith(ARCHIVE_SUFFIXES):
                reason = archive_problem(info.filename, archive.read(info))
            if reason is None and staged_path(info.filename) in seen:
                reason = "duplicate path after flattening"
            if reason is not None:
                manifest.excluded.append({"member": info.filename, "reason": reason})
                continue
            seen.add(staged_path(info.filename))
            manifest.included.append(
                {
                    "member": info.filename,
                    "path": staged_path(info.filename),
                    "bytes": info.file_size,
                }
            )
    return manifest


def stage_capsule(zip_path: Path, dest: Path, force: bool = False) -> Path:
    """Extract the allow-listed members of `zip_path` into `dest/data`; write `dest/manifest.json`
    next to it (outside /data). Returns the data directory. Reuses an existing staging whose
    manifest matches the zip, after re-verifying it."""
    data_dir = dest / DATA_DIR
    manifest_file = dest / MANIFEST
    if manifest_file.exists() and not force:
        old = json.loads(manifest_file.read_text(encoding="utf-8"))
        if old.get("zip_sha256") == _sha256(zip_path):
            verify_staged(dest)
            return data_dir
    manifest = plan(zip_path)
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
    """Raise unless `dest/data` holds exactly the manifest's files and none is a forbidden type."""
    manifest_file = dest / MANIFEST
    data_dir = dest / DATA_DIR
    if not manifest_file.exists() or not data_dir.is_dir():
        raise IntegrityError(f"{dest}: not a staged capsule (no manifest or no data directory)")
    manifest = Manifest(**json.loads(manifest_file.read_text(encoding="utf-8")))
    found: set[str] = set()
    for path in data_dir.rglob("*"):
        if path.is_symlink():
            raise IntegrityError(f"{path}: symbolic link in staged data")
        if path.is_dir():
            continue
        relative = path.relative_to(data_dir).as_posix()
        # Re-check the name as if it sat in a data folder: catches a notebook dropped in later.
        reason = exclusion_reason(f"CapsuleData/{relative}")
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


def leak_scan(data_dir: Path, secrets: list[str]) -> list[str]:
    """Staged files (up to LEAK_SCAN_MAX_BYTES each) that contain one of `secrets` verbatim.

    A backstop for write-ups that slip through as plain text; it does not look inside
    compressed formats (xlsx, gz, rds)."""
    needles = [secret.encode("utf-8") for secret in secrets if secret]
    hits: list[str] = []
    if not needles:
        return hits
    for path in sorted(data_dir.rglob("*")):
        if not path.is_file() or path.stat().st_size > LEAK_SCAN_MAX_BYTES:
            continue
        payload = path.read_bytes()
        if any(needle in payload for needle in needles):
            hits.append(path.relative_to(data_dir).as_posix())
    return hits
