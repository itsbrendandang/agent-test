"""Put one capsule's staged data on a Modal Volume, and nothing else.

Why a Volume and not an upload per run (measured from this machine, 2026-11-15, see
image/MEASUREMENTS.md): a 151 MB capsule takes 0.6 s to put on a Volume once, against 8.4 s
through the sandbox file API and 23.9 s as a tar stream, and those two would be paid again for
every sandbox (the swarm uses two per run). Only the capsules a run needs are uploaded, each
once.

The answer boundary. What is uploaded is the staged `data/` folder of one capsule, after
`staging.verify_staged` and `staging.leak_scan` have passed on the host (runner.py does both
before calling this). It is the same set of files local Docker mounts at /data. Never
uploaded: the question file, a capsule zip, a notebook, `manifest.json` (it names the excluded
members), the shuffle salt, a run folder. `plan_upload` builds the list from the manifest and
refuses anything else, and the upload is read back and compared before it is used.

Layout on the Volume, with a neutral directory name (a hash; not the capsule's uuid or key):

    /<data key>/data/<the staged files>     mounted read-only into the sandbox, this folder only
    /<data key>/complete.json               written last; listing hash and content hash

This module imports nothing from Modal at import time; the Volume is passed in.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Protocol

from . import staging
from .dataset import HF_REVISION

VOLUME_NAME = f"bixbench-v1-staged-{HF_REVISION[:8]}"
COMPLETE = "complete.json"


class VolumeLike(Protocol):
    """The part of `modal.Volume` used here (a fake stands in for it in tests)."""

    def listdir(self, path: str, *, recursive: bool = False) -> list[Any]: ...
    def batch_upload(self, force: bool = False) -> Any: ...
    def read_file(self, path: str) -> Any: ...


@dataclass(frozen=True)
class StagedData:
    """What the sandbox must find at /data: enough to check it byte for byte."""

    key: str  # neutral directory name on the Volume
    files: int
    bytes: int
    listing_sha256: str  # of the sorted "path<TAB>bytes" lines
    content_sha256: str  # of the sorted "sha256  ./path" lines, as `sha256sum` prints them

    @property
    def data_path(self) -> str:
        return f"/{self.key}/data"

    @property
    def complete_path(self) -> str:
        return f"/{self.key}/{COMPLETE}"


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def listing_lines(sizes: dict[str, int]) -> str:
    """`find /data -type f -printf '%P\\t%s\\n' | LC_ALL=C sort`, computed on the host."""
    rows = sorted(f"{path}\t{size}".encode() for path, size in sizes.items())
    return b"".join(row + b"\n" for row in rows).decode()


def content_lines(hashes: dict[str, str]) -> str:
    """`cd /data && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum`."""
    rows = sorted(hashes.items(), key=lambda item: f"./{item[0]}".encode())
    return "".join(f"{digest}  ./{path}\n" for path, digest in rows)


def describe(data_dir: Path, manifest: staging.Manifest) -> StagedData:
    """Hash the staged files of one capsule. The file set is the manifest's, checked against
    the folder: an extra or a missing file is an integrity error, not something to upload."""
    on_disk = {
        p.relative_to(data_dir).as_posix(): p
        for p in sorted(data_dir.rglob("*"))
        if p.is_file() and not p.is_symlink()
    }
    links = [p for p in data_dir.rglob("*") if p.is_symlink()]
    if links:
        raise staging.IntegrityError(f"staged data holds a symbolic link: {links[0].name}")
    if set(on_disk) != manifest.paths:
        raise staging.IntegrityError("staged data does not match its manifest; not uploading")
    sizes = {path: p.stat().st_size for path, p in on_disk.items()}
    for item in manifest.included:
        if sizes[str(item["path"])] != int(str(item["bytes"])):
            raise staging.IntegrityError(f"staged file changed size: {item['path']}")
    listing = listing_lines(sizes)
    content = content_lines({path: _file_sha256(p) for path, p in on_disk.items()})
    listing_hash = hashlib.sha256(listing.encode()).hexdigest()
    content_hash = hashlib.sha256(content.encode()).hexdigest()
    # The key names the content and nothing else: no uuid, short id, run, model or solver.
    key = hashlib.sha256(f"{listing_hash}:{content_hash}".encode()).hexdigest()[:32]
    return StagedData(key, len(sizes), sum(sizes.values()), listing_hash, content_hash)


def plan_upload(
    data_dir: Path, manifest: staging.Manifest, staged: StagedData
) -> list[tuple[Path, str]]:
    """(local file, path on the Volume) for every file to upload: the manifest's files under
    `<key>/data/`, each an allowed data type. Nothing else can be in the list."""
    plan: list[tuple[Path, str]] = []
    for relative in sorted(manifest.paths):
        problem = staging.file_type_problem(relative)
        if problem is not None:
            raise staging.IntegrityError(f"not uploading {relative}: {problem}")
        local = data_dir / relative
        if local.is_symlink() or not local.is_file():
            raise staging.IntegrityError(f"not uploading {relative}: not a regular file")
        if ".." in PurePosixPath(relative).parts or PurePosixPath(relative).is_absolute():
            raise staging.IntegrityError(f"not uploading {relative}: unsafe path")
        plan.append((local, f"{staged.data_path}/{relative}"))
    return plan


def _is_file(entry: Any) -> bool:
    return getattr(getattr(entry, "type", None), "name", "") == "FILE"


def _is_directory(entry: Any) -> bool:
    return getattr(getattr(entry, "type", None), "name", "") == "DIRECTORY"


def remote_listing(volume: VolumeLike, staged: StagedData) -> dict[str, int] | None:
    """{relative path: bytes} of what the Volume holds under the capsule's data folder, or None
    when there is nothing. Anything that is not a file or a directory is an integrity error."""
    try:
        entries = volume.listdir(staged.data_path, recursive=True)
    except Exception as error:  # modal raises NotFoundError; a fake raises FileNotFoundError
        if type(error).__name__ in ("NotFoundError", "FileNotFoundError"):
            return None
        raise
    prefix = staged.data_path.strip("/") + "/"
    found: dict[str, int] = {}
    for entry in entries:
        path = str(entry.path).strip("/")
        if _is_directory(entry):
            continue
        if not _is_file(entry) or not path.startswith(prefix):
            raise staging.IntegrityError(f"unexpected entry on the Volume: {path}")
        found[path.removeprefix(prefix)] = int(entry.size)
    return found or None


def _read_complete(volume: VolumeLike, staged: StagedData) -> dict[str, Any] | None:
    try:
        payload = b"".join(volume.read_file(staged.complete_path))
        document = json.loads(payload)
    except Exception:
        return None
    return document if isinstance(document, dict) else None


def ensure_uploaded(
    volume: VolumeLike, data_dir: Path, manifest: staging.Manifest
) -> tuple[StagedData, bool]:
    """Make sure the Volume holds exactly this capsule's staged files. Returns the description
    and whether an upload happened. Idempotent: a complete, matching copy is left alone; a
    partial or different one is replaced (the key is a content hash, so "different" means a
    broken earlier upload)."""
    staged = describe(data_dir, manifest)
    expected = {str(item["path"]): int(str(item["bytes"])) for item in manifest.included}
    marker = _read_complete(volume, staged)
    if (
        marker is not None
        and marker.get("listing_sha256") == staged.listing_sha256
        and marker.get("content_sha256") == staged.content_sha256
        and remote_listing(volume, staged) == expected
    ):
        return staged, False
    plan = plan_upload(data_dir, manifest, staged)
    with volume.batch_upload(force=True) as batch:
        for local, remote in plan:
            batch.put_file(str(local), remote)
    found = remote_listing(volume, staged)
    if found != expected:
        raise staging.IntegrityError(
            "the Volume does not hold exactly the staged files after the upload "
            f"({len(found or {})} found, {len(expected)} expected)"
        )
    document = {
        "files": staged.files,
        "bytes": staged.bytes,
        "listing_sha256": staged.listing_sha256,
        "content_sha256": staged.content_sha256,
        "dataset_revision": HF_REVISION,
    }
    with volume.batch_upload(force=True) as batch:
        import io

        batch.put_file(io.BytesIO(json.dumps(document).encode()), staged.complete_path)
    return staged, True


# Paths that must never be on the Volume, whatever put them there.
FORBIDDEN_PARTS = (
    staging.ZIP_PREFIX,  # a capsule zip (data archives inside a capsule have other names)
    ".jsonl",
    ".ipynb",
    "manifest.json",
    "shuffle_salt",
    "run.json",
    "grade.json",
)


def audit_volume(volume: VolumeLike) -> list[str]:
    """Every path on the Volume that should not be there: a problem list (empty = clean). The
    Volume may hold only `<32 hex>/data/**` (allowed data types) and `<32 hex>/complete.json`."""
    problems: list[str] = []
    for entry in volume.listdir("/", recursive=True):
        path = str(entry.path).strip("/")
        parts = PurePosixPath(path).parts
        if not parts:
            continue
        if len(parts[0]) != 32 or any(c not in "0123456789abcdef" for c in parts[0]):
            problems.append(f"{path}: top folder is not a data key")
            continue
        if _is_directory(entry):
            continue
        if not _is_file(entry):
            problems.append(f"{path}: not a regular file")
        elif len(parts) == 2 and parts[1] == COMPLETE:
            continue
        elif len(parts) >= 3 and parts[1] == "data":
            relative = "/".join(parts[2:])
            problem = staging.file_type_problem(relative)
            if problem is not None:
                problems.append(f"{path}: {problem}")
            elif any(part.lower() in path.lower() for part in FORBIDDEN_PARTS):
                problems.append(f"{path}: a name that must never be uploaded")
        else:
            problems.append(f"{path}: outside <key>/data and <key>/{COMPLETE}")
    return problems
