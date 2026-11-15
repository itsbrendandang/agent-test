"""Copies the engine's run folders between the container's own disk and a Modal Volume.

Why this exists. A Modal Volume is not an ordinary disk: what a container writes becomes durable only when the
Volume is committed (by `commit()`, by Modal's background commit every few seconds, and once more when the
container shuts down), and two files written one after the other can end up in different commits. The engine
keeps one SQLite database per run in WAL mode (`session.sqlite` plus `-wal` and `-shm` side files) next to an
append-only `events.jsonl`. A commit that catches the database without its `-wal` file, or half of a file,
would give a run that cannot be opened. So the engine never writes to the Volume. It writes to the container's
disk, and this module copies finished, checked snapshots to the Volume.

The rules:
  1. A *unit* is one run folder (or the loose files of a folder). A snapshot of a unit is ONE new file on the
     Volume, `gen-<number>-<hash>.tar`. It is written once and never changed, and its name carries the SHA-256
     of its bytes. One file, because the first read of a file from a Volume in a new container is slow (about
     0.2 s was measured), and a restore has to read every run.
  2. A database is copied with SQLite's own backup call, which gives one complete file with no side files.
  3. While the files of the changed units are read, the engine is paused (SIGSTOP), so the database, the event
     log and `run.json` of a run are from the same instant: the snapshot is what a crash of the engine at that
     instant would have left, and the engine is built to continue from that (durable replay). One state is not
     stored: a `.json` file caught half-written. That unit waits for the next snapshot.
  4. On restore a generation is used only when the SHA-256 of the file equals the hash in its name; otherwise
     the one before it is used. So a snapshot that was cut off, or committed half-way, is never restored.
  5. After the Volume commit has succeeded, the older generations of that unit are removed.

Only the Python standard library is used. Nothing here knows about Modal: `commit` and `freeze` are passed in.
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import tarfile
import threading
import time
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote

FILES_UNIT = "_files"  # the loose files of a collection folder
SAFE_NAME = re.compile(r"^[\w.-]{1,200}$")
GEN = re.compile(r"^gen-(\d{8})-([0-9a-f]{32})\.tar$")
GEN_LIKE = re.compile(r"^gen-\d+")
READERS = 16  # generations read at once on restore
SQLITE_MAGIC = b"SQLite format 3\x00"

# Never copied. The side files are covered by the backup call. The session token is a secret of one engine
# process and is made again at every start. A ".takeover" file is a half-second marker of runlock.ts.
SKIP_SUFFIXES = ("-wal", "-shm", ".takeover", ".tmp")
SKIP_NAMES = (".token", ".DS_Store")


class SnapshotSkipped(Exception):
    """A unit could not be read consistently right now (for example a locked database). It is tried again."""


def _skipped(name: str) -> bool:
    return name in SKIP_NAMES or name.startswith(".token.") or name.endswith(SKIP_SUFFIXES)


def _name_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:32]


def _is_sqlite(file: Path) -> bool:
    try:
        with file.open("rb") as handle:
            return handle.read(16) == SQLITE_MAGIC
    except OSError:
        return False


def _walk(root: Path) -> Iterator[Path]:
    """Every regular file under root, sorted. Symbolic links are not followed and not listed."""
    for folder, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = sorted(d for d in dirs if not (Path(folder) / d).is_symlink())
        for name in sorted(files):
            file = Path(folder) / name
            if not file.is_symlink() and file.is_file():
                yield file


def backup_sqlite(source: Path, target: Path) -> None:
    """One complete copy of a database that may be open elsewhere, WAL included. The source is opened read-only."""
    try:
        src = sqlite3.connect(f"file:{quote(str(source))}?mode=ro", uri=True, timeout=1.0)
    except sqlite3.Error as error:
        raise SnapshotSkipped(f"{source.name}: {error}") from error
    try:
        dst = sqlite3.connect(str(target))
        try:
            src.backup(dst)
        finally:
            dst.close()
        check = sqlite3.connect(f"file:{quote(str(target))}?mode=ro&immutable=1", uri=True)
        try:
            result = check.execute("PRAGMA quick_check").fetchone()
        finally:
            check.close()
        if not result or result[0] != "ok":
            raise SnapshotSkipped(f"{source.name}: the copy did not pass SQLite's check ({result})")
    except sqlite3.Error as error:
        raise SnapshotSkipped(f"{source.name}: {error}") from error
    finally:
        src.close()


class Persister:
    """Snapshots `collections` (name -> folder on the container's disk) to `volume_root`, and restores them.

    commit: makes the Volume durable (modal.Volume.commit). It may raise; then older generations are kept.
    freeze: a context manager that pauses the engine while changed files are read. None: no pause.
    """

    def __init__(self, collections: dict[str, Path], volume_root: Path, *, commit: Callable[[], None] = lambda: None,
                 freeze: Callable[[], contextlib.AbstractContextManager[None]] | None = None,
                 staging: Path | None = None, log: Callable[[str], None] = print) -> None:
        for name in collections:
            if not SAFE_NAME.match(name):
                raise ValueError(f"bad collection name: {name!r}")
        self.collections = {name: Path(folder) for name, folder in collections.items()}
        self.volume_root = Path(volume_root)
        self.commit = commit
        self.freeze = freeze or contextlib.nullcontext
        self.staging = Path(staging) if staging else self.volume_root.parent / f".{self.volume_root.name}-staging-{os.getpid()}"
        self.log = log
        self._seen: dict[tuple[str, str], tuple] = {}  # unit -> fingerprint of what the Volume holds
        self._lock = threading.Lock()

    # ---- units -----------------------------------------------------------------------------------------------

    def _units(self) -> list[tuple[str, str]]:
        units: list[tuple[str, str]] = []
        nested = set(self.collections.values())
        for collection, folder in self.collections.items():
            if not folder.is_dir():
                continue
            loose = False
            for entry in sorted(folder.iterdir()):
                if entry.is_symlink():
                    continue
                if entry.is_dir():
                    if entry in nested:
                        continue  # a collection of its own (board/runs/.research inside board/runs): one unit per folder in it
                    if SAFE_NAME.match(entry.name) and entry.name != FILES_UNIT and not GEN_LIKE.match(entry.name):
                        units.append((collection, entry.name))
                    else:
                        self.log(f"persist: {collection}/{entry.name} has a name that cannot be stored; skipped")
                elif entry.is_file() and not _skipped(entry.name):
                    loose = True
            if loose:
                units.append((collection, FILES_UNIT))
        return units

    def _unit_files(self, unit: tuple[str, str]) -> list[tuple[str, Path]]:
        """(path inside the unit, file) for every file that belongs to the unit, side files included."""
        collection, name = unit
        folder = self.collections[collection]
        if name == FILES_UNIT:
            return [(f.name, f) for f in sorted(folder.iterdir()) if f.is_file() and not f.is_symlink()]
        return [(str(f.relative_to(folder / name)), f) for f in _walk(folder / name)]

    def _fingerprint(self, unit: tuple[str, str]) -> tuple:
        """Changes when any file of the unit changes. The -wal file counts: new database rows land there first."""
        marks = []
        for rel, file in self._unit_files(unit):
            if _skipped(file.name) and not file.name.endswith("-wal"):
                continue
            try:
                stat = file.stat()
            except OSError:
                continue
            marks.append((rel, stat.st_size, stat.st_mtime_ns))
        return tuple(marks)

    def _unit_dir(self, unit: tuple[str, str]) -> Path:
        return self.volume_root / unit[0] / unit[1]

    @staticmethod
    def _generations(unit_dir: Path) -> list[tuple[int, Path]]:
        """The unit's generation files, newest first."""
        if not unit_dir.is_dir():
            return []
        found = [(int(m.group(1)), entry) for entry in unit_dir.iterdir() if (m := GEN.match(entry.name)) and entry.is_file()]
        return sorted(found, reverse=True)

    # ---- snapshot --------------------------------------------------------------------------------------------

    def _stage(self, unit: tuple[str, str], target: Path) -> list[str]:
        """Copy the unit to `target` on the local disk. Returns the paths copied."""
        files: list[str] = []
        target.mkdir(parents=True, exist_ok=True)
        for rel, file in self._unit_files(unit):
            if _skipped(file.name):
                continue
            out = target / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            if _is_sqlite(file):
                backup_sqlite(file, out)
            else:
                try:
                    shutil.copyfile(file, out)
                except FileNotFoundError:
                    continue  # removed between the listing and the copy (a temporary file)
                if file.suffix == ".json":
                    # The engine rewrites run.json in place. Paused between "emptied" and "written", the file is
                    # not JSON: wait for the next snapshot instead of storing a state no reader can open.
                    try:
                        json.loads(out.read_bytes())
                    except ValueError as error:
                        raise SnapshotSkipped(f"{rel} is being written") from error
            files.append(rel)
        return files

    @staticmethod
    def _pack(folder: Path, files: list[str]) -> bytes:
        """One tar of the staged unit: plain files only, in a fixed order, with no owner and no machine detail."""
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w", format=tarfile.PAX_FORMAT) as tar:
            for rel in sorted(files):
                info = tarfile.TarInfo(rel)
                data = (folder / rel).read_bytes()
                info.size, info.mode, info.mtime = len(data), 0o644, int((folder / rel).stat().st_mtime)
                tar.addfile(info, io.BytesIO(data))
        return buffer.getvalue()

    @staticmethod
    def _unpack(data: bytes, target: Path) -> int:
        """Write the tar's files under `target`. Only plain files with a path that stays inside are accepted."""
        count = 0
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:") as tar:
            members = tar.getmembers()
            for member in members:
                parts = Path(member.name).parts
                if not member.isfile() or Path(member.name).is_absolute() or ".." in parts or not parts:
                    raise ValueError(f"not a plain file inside the unit: {member.name}")
            for member in members:
                out = target / member.name
                out.parent.mkdir(parents=True, exist_ok=True)
                source = tar.extractfile(member)
                assert source is not None
                out.write_bytes(source.read())
                os.utime(out, (member.mtime, member.mtime))
                count += 1
        return count

    def snapshot(self) -> dict[str, list[str]]:
        """Write a new generation of every unit that changed since the last snapshot, then commit the Volume."""
        with self._lock:
            return self._snapshot()

    def _snapshot(self) -> dict[str, list[str]]:
        started = time.monotonic()
        result: dict[str, list[str]] = {"written": [], "skipped": [], "failed": []}
        changed = [unit for unit in self._units() if self._fingerprint(unit) != self._seen.get(unit)]
        if not changed:
            return result
        shutil.rmtree(self.staging, ignore_errors=True)
        staged: list[tuple[tuple[str, str], Path, list[str], tuple]] = []
        with self.freeze():
            for unit in changed:
                target = self.staging / unit[0] / unit[1]
                try:
                    mark = self._fingerprint(unit)  # taken while the engine is paused: it is exactly what is copied
                    files = self._stage(unit, target)
                except SnapshotSkipped as error:
                    result["skipped"].append(f"{unit[0]}/{unit[1]}: {error}")
                    continue
                staged.append((unit, target, files, mark))
        frozen = time.monotonic() - started

        done: list[tuple[tuple[str, str], Path, int, tuple]] = []
        for unit, source, files, mark in staged:
            unit_dir = self._unit_dir(unit)
            try:
                data = self._pack(source, files)
                numbers = [int(m.group(0)[4:]) for entry in (unit_dir.iterdir() if unit_dir.is_dir() else []) if (m := GEN_LIKE.match(entry.name))]
                number = max(numbers, default=0) + 1  # past every earlier attempt, also a broken one
                unit_dir.mkdir(parents=True, exist_ok=True)
                final = unit_dir / f"gen-{number:08d}-{_name_hash(data)}.tar"
                part = unit_dir / f"gen-{number:08d}.part"
                part.write_bytes(data)
                os.replace(part, final)  # the name is complete only when the bytes are
                done.append((unit, unit_dir, number, mark))
            except OSError as error:
                result["failed"].append(f"{unit[0]}/{unit[1]}: {error}")
        shutil.rmtree(self.staging, ignore_errors=True)
        if not done:
            return result
        try:
            self.commit()
        except Exception as error:  # noqa: BLE001 - whatever the Volume says, the older generations stay
            result["failed"].append(f"commit: {error}")
            self.log(f"persist: the Volume commit failed ({error}); older snapshots are kept and this one is tried again")
            return result
        for unit, unit_dir, number, mark in done:
            self._seen[unit] = mark
            result["written"].append(f"{unit[0]}/{unit[1]}@{number}")
            for entry in list(unit_dir.iterdir()):
                match = GEN_LIKE.match(entry.name)
                if match and int(match.group(0)[4:]) < number:
                    with contextlib.suppress(OSError):
                        entry.unlink()  # made durable by the next commit
        self.log(f"persist: saved {len(done)} unit(s) in {time.monotonic() - started:.2f} s (engine paused {frozen:.2f} s)"
                 + (f"; not saved this time: {result['skipped']}" if result["skipped"] else ""))
        return result

    # ---- restore ---------------------------------------------------------------------------------------------

    @staticmethod
    def read_generation(file: Path) -> tuple[bytes | None, str]:
        """(the bytes, "") when the file's SHA-256 equals the hash in its name, else (None, the reason)."""
        match = GEN.match(file.name)
        if not match:
            return None, "not a finished snapshot file (it was cut off)"
        try:
            data = file.read_bytes()
        except OSError as error:
            return None, f"unreadable: {error}"
        if _name_hash(data) != match.group(2):
            return None, "its bytes do not match the hash in its name"
        return data, ""

    def _newest_good(self, unit_dir: Path) -> tuple[int | None, bytes | None, list[str]]:
        """(number, bytes, what was rejected on the way) for the newest generation that checks out."""
        rejected: list[str] = []
        entries = sorted((e for e in unit_dir.iterdir() if GEN_LIKE.match(e.name)), key=lambda e: e.name, reverse=True)
        for entry in entries:
            data, why = self.read_generation(entry)
            number = int(GEN_LIKE.match(entry.name).group(0)[4:])  # type: ignore[union-attr]
            if data is not None:
                try:
                    with tarfile.open(fileobj=io.BytesIO(data), mode="r:") as tar:
                        tar.getmembers()
                    return number, data, rejected
                except tarfile.TarError as error:
                    why = f"not a tar file: {error}"
            rejected.append(f"@{number}: {why}")
        return None, None, rejected

    def _unit_dirs(self) -> list[tuple[str, Path]]:
        found: list[tuple[str, Path]] = []
        for collection in self.collections:
            base = self.volume_root / collection
            if base.is_dir():
                found += [(collection, p) for p in sorted(base.iterdir()) if p.is_dir() and SAFE_NAME.match(p.name)]
        return found

    def inventory(self) -> list[dict[str, object]]:
        """Every unit on the Volume with its newest good generation. Reads only."""
        rows: list[dict[str, object]] = []
        for collection, unit_dir in self._unit_dirs():
            number, data, rejected = self._newest_good(unit_dir)
            row: dict[str, object] = {"unit": f"{collection}/{unit_dir.name}", "good": number, "bad": rejected}
            if data is not None:
                with tarfile.open(fileobj=io.BytesIO(data), mode="r:") as tar:
                    row.update(files=len(tar.getmembers()), bytes=len(data))
            rows.append(row)
        return rows

    def restore(self) -> dict[str, list[str]]:
        """Copy the newest good generation of every unit from the Volume to the local folders. Call before the engine starts."""
        with self._lock:
            result: dict[str, list[str]] = {"restored": [], "rejected": [], "lost": []}
            units = self._unit_dirs()
            with ThreadPoolExecutor(READERS) as pool:  # the first read of each file from the Volume is the slow part
                found = list(pool.map(lambda item: self._newest_good(item[1]), units))
            for (collection, unit_dir), (number, data, rejected) in zip(units, found, strict=True):
                name, folder = unit_dir.name, self.collections[collection]
                result["rejected"] += [f"{collection}/{name}{line}" for line in rejected]
                if data is None:
                    result["lost"].append(f"{collection}/{name}")
                    continue
                target = folder if name == FILES_UNIT else folder / name
                scratch = self.staging / "restore" / collection / name
                shutil.rmtree(scratch, ignore_errors=True)
                scratch.mkdir(parents=True)
                try:
                    self._unpack(data, scratch)  # unpacked aside first: a bad tar changes nothing
                except (ValueError, tarfile.TarError, OSError) as error:
                    result["rejected"].append(f"{collection}/{name}@{number}: {error}")
                    result["lost"].append(f"{collection}/{name}")
                    continue
                if name == FILES_UNIT:
                    folder.mkdir(parents=True, exist_ok=True)
                    for old in folder.iterdir():  # the Volume's copy replaces the loose files of the image
                        if old.is_file() and not old.is_symlink():
                            old.unlink()
                    for item in scratch.iterdir():
                        shutil.move(str(item), str(folder / item.name))
                else:
                    shutil.rmtree(target, ignore_errors=True)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(scratch), str(target))
                unit = (collection, name)
                self._seen[unit] = self._fingerprint(unit)
                result["restored"].append(f"{collection}/{name}@{number}")
            shutil.rmtree(self.staging, ignore_errors=True)
            for kind in ("rejected", "lost"):
                for line in result[kind]:
                    self.log(f"persist: {kind}: {line}")
            self.log(f"persist: restored {len(result['restored'])} unit(s) from the Volume")
            return result
