"""Tests of persist.py. No Modal, no network: the "Volume" is a folder and `commit` is a counter."""
from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import signal
import sqlite3
import subprocess
import tarfile
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import persist  # noqa: E402
from persist import Persister  # noqa: E402

WRITER = Path(__file__).with_name("writer.py")


def make(tmp: Path, **options) -> tuple[Persister, Path, Path, list[int]]:
    local, volume = tmp / "local", tmp / "volume" / "v1"
    (local / "runs").mkdir(parents=True, exist_ok=True)
    commits: list[int] = []
    p = Persister({"runs": local / "runs", "notes": local / "notes"}, volume, commit=lambda: commits.append(1), log=lambda _line: None, **options)
    return p, local, volume, commits


def wal_db(file: Path, rows: int) -> sqlite3.Connection:
    file.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(file, isolation_level=None)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("CREATE TABLE IF NOT EXISTS steps (n INTEGER PRIMARY KEY, body TEXT)")
    for n in range(rows):
        db.execute("INSERT INTO steps (body) VALUES (?)", (f"step {n}",))
    return db


def rows_of(file: Path) -> int:
    db = sqlite3.connect(f"file:{file}?mode=ro&immutable=1", uri=True)
    try:
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        return db.execute("SELECT COUNT(*) FROM steps").fetchone()[0]
    finally:
        db.close()


def gens(volume: Path, unit: str) -> list[str]:
    """The generation numbers of a unit on the Volume, with "!" for a file that is not a finished snapshot."""
    return sorted(f.name[4:12] + ("" if persist.GEN.match(f.name) else "!") for f in (volume / unit).iterdir())


def members(file: Path) -> list[str]:
    with tarfile.open(file) as tar:
        return sorted(tar.getnames())


def fresh(tmp: Path, name: str = "second") -> tuple[Persister, Path]:
    """A new container: empty local disk, the same Volume."""
    local = tmp / name
    return Persister({"runs": local / "runs", "notes": local / "notes"}, tmp / "volume" / "v1", log=lambda _line: None), local


def test_round_trip_with_an_open_wal_database(tmp_path: Path) -> None:
    p, local, volume, commits = make(tmp_path)
    run = local / "runs" / "r1"
    db = wal_db(run / "session.sqlite", 5)
    db.execute("BEGIN IMMEDIATE")
    db.execute("INSERT INTO steps (body) VALUES ('not committed')")  # an open write transaction, as when the engine is paused mid-step
    (run / "events.jsonl").write_text('{"n":1}\n{"n":2}\n')
    (run / "expertise").mkdir()
    (run / "expertise" / "scout.md").write_text("note")
    (local / "runs" / ".exa-ledger.jsonl").write_text('{"usd":0.007}\n')
    (local / "runs" / ".token").write_text("secret-token")
    assert (run / "session.sqlite-wal").exists()

    out = p.snapshot()
    assert sorted(out["written"]) == ["runs/_files@1", "runs/r1@1"] and commits == [1]
    stored = sorted(f for f in volume.rglob("*") if f.is_file())
    assert [str(f.relative_to(volume))[:-37] for f in stored] == ["runs/_files/gen-00000001", "runs/r1/gen-00000001"]  # one file per unit
    assert members(stored[0]) == [".exa-ledger.jsonl"]
    assert members(stored[1]) == ["events.jsonl", "expertise/scout.md", "session.sqlite"]  # no token, no -wal, no -shm: they never leave the container
    assert all(b"secret-token" not in f.read_bytes() for f in stored)
    db.execute("ROLLBACK")
    db.close()

    q, second = fresh(tmp_path)
    assert sorted(q.restore()["restored"]) == ["runs/_files@1", "runs/r1@1"]
    assert rows_of(second / "runs" / "r1" / "session.sqlite") == 5  # the committed rows, not the open transaction
    assert (second / "runs" / "r1" / "events.jsonl").read_text() == '{"n":1}\n{"n":2}\n'
    assert (second / "runs" / "r1" / "expertise" / "scout.md").read_text() == "note"
    assert (second / "runs" / ".exa-ledger.jsonl").read_text() == '{"usd":0.007}\n'
    engine = sqlite3.connect(second / "runs" / "r1" / "session.sqlite")  # the engine can open it and write again
    engine.execute("INSERT INTO steps (body) VALUES ('after restart')")
    engine.commit()
    engine.close()
    assert q.snapshot()["written"] == ["runs/r1@2"]  # only what changed after the restore


def test_unchanged_units_are_not_written_again_and_old_generations_go(tmp_path: Path) -> None:
    p, local, volume, commits = make(tmp_path)
    for name in ("done", "live"):
        (local / "runs" / name).mkdir()
        (local / "runs" / name / "events.jsonl").write_text("1\n")
    p.snapshot()
    assert p.snapshot() == {"written": [], "skipped": [], "failed": []} and commits == [1]
    with (local / "runs" / "live" / "events.jsonl").open("a") as f:
        f.write("2\n")
    assert p.snapshot()["written"] == ["runs/live@2"]
    assert gens(volume, "runs/live") == ["00000002"]
    assert gens(volume, "runs/done") == ["00000001"]  # a finished run is written once


def test_a_snapshot_that_was_cut_off_is_not_restored(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    p, local, volume, _ = make(tmp_path)
    run = local / "runs" / "r1"
    wal_db(run / "session.sqlite", 3).close()
    (run / "events.jsonl").write_text("a\n")
    p.snapshot()
    (run / "events.jsonl").write_text("a\nb\n")
    db = sqlite3.connect(run / "session.sqlite")
    db.execute("INSERT INTO steps (body) VALUES ('later')")
    db.commit()
    db.close()

    def dies_before_the_name_is_complete(src, dst):  # the container is killed while the second generation is being written
        Path(src).write_bytes(Path(src).read_bytes()[:1000])  # and only part of it reached the Volume
        raise KeyboardInterrupt
    monkeypatch.setattr(persist.os, "replace", dies_before_the_name_is_complete)
    with pytest.raises(KeyboardInterrupt):
        p.snapshot()
    monkeypatch.undo()
    assert gens(volume, "runs/r1") == ["00000001", "00000002!"]

    q, second = fresh(tmp_path)
    out = q.restore()
    assert out["restored"] == ["runs/r1@1"] and "cut off" in out["rejected"][0]
    assert (second / "runs" / "r1" / "events.jsonl").read_text() == "a\n" and rows_of(second / "runs" / "r1" / "session.sqlite") == 3  # the pair that belongs together
    assert q.snapshot()["written"] == [] and (second / "runs" / "r1" / "events.jsonl").write_text("a\nc\n")
    assert q.snapshot()["written"] == ["runs/r1@3"]  # numbering goes on past the broken generation, which is then removed
    assert gens(volume, "runs/r1") == ["00000003"]


@pytest.mark.parametrize("damage", ["truncate", "flip", "empty", "renamed", "not-a-tar"])
def test_a_damaged_generation_falls_back_to_the_one_before(tmp_path: Path, damage: str) -> None:
    p, local, volume, _ = make(tmp_path)
    run = local / "runs" / "r1"
    wal_db(run / "session.sqlite", 2).close()
    p.snapshot()
    first = next((volume / "runs" / "r1").iterdir())
    kept = first.read_bytes()
    db = sqlite3.connect(run / "session.sqlite")
    db.execute("INSERT INTO steps (body) VALUES ('x')")
    db.commit()
    db.close()
    p.snapshot()
    first.write_bytes(kept)  # as if the commit that removed the older generation had not happened yet
    newest = next(f for f in (volume / "runs" / "r1").iterdir() if f.name.startswith("gen-00000002"))
    data = newest.read_bytes()
    if damage == "truncate":
        newest.write_bytes(data[: len(data) // 2])
    elif damage == "flip":
        newest.write_bytes(data[:3000] + bytes([data[3000] ^ 1]) + data[3001:])
    elif damage == "empty":
        newest.write_bytes(b"")
    elif damage == "renamed":  # another generation's bytes under this name
        newest.write_bytes(kept)
    else:  # bytes that match their name but are no tar: cannot happen by accident, must still not be trusted
        newest.unlink()
        (newest.parent / f"gen-00000002-{persist._name_hash(b'not a tar')}.tar").write_bytes(b"not a tar")
    q, second = fresh(tmp_path)
    out = q.restore()
    assert out["restored"] == ["runs/r1@1"] and len(out["rejected"]) == 1 and out["lost"] == []
    assert rows_of(second / "runs" / "r1" / "session.sqlite") == 2


def test_a_unit_with_no_good_generation_is_reported_lost_and_nothing_is_invented(tmp_path: Path) -> None:
    p, local, volume, _ = make(tmp_path)
    (local / "runs" / "r1").mkdir()
    (local / "runs" / "r1" / "run.json").write_text("{}")
    p.snapshot()
    only = next((volume / "runs" / "r1").iterdir())
    only.write_bytes(only.read_bytes()[:-1])
    q, second = fresh(tmp_path)
    out = q.restore()
    assert out["lost"] == ["runs/r1"] and out["restored"] == [] and not (second / "runs" / "r1").exists()
    assert q.inventory() == [{"unit": "runs/r1", "good": None, "bad": ["@1: its bytes do not match the hash in its name"]}]


def test_a_failed_commit_keeps_the_older_generation_and_tries_again(tmp_path: Path) -> None:
    p, local, volume, _ = make(tmp_path)
    (local / "runs" / "r1").mkdir()
    (local / "runs" / "r1" / "events.jsonl").write_text("1\n")
    p.snapshot()
    (local / "runs" / "r1" / "events.jsonl").write_text("1\n2\n")
    def refuse() -> None:
        raise RuntimeError("volume busy")
    p.commit = refuse
    out = p.snapshot()
    assert out["written"] == [] and out["failed"] == ["commit: volume busy"]
    assert gens(volume, "runs/r1") == ["00000001", "00000002"]
    p.commit = lambda: None
    assert p.snapshot()["written"] == ["runs/r1@3"]
    assert gens(volume, "runs/r1") == ["00000003"]


def test_a_locked_database_skips_the_whole_unit_this_time(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    p, local, volume, _ = make(tmp_path)
    run = local / "runs" / "r1"
    wal_db(run / "session.sqlite", 1).close()
    (run / "events.jsonl").write_text("1\n")
    (local / "runs" / "r2").mkdir()
    (local / "runs" / "r2" / "events.jsonl").write_text("1\n")
    def busy(source: Path, target: Path) -> None:
        raise persist.SnapshotSkipped(f"{source.name}: database is locked")
    monkeypatch.setattr(persist, "backup_sqlite", busy)
    out = p.snapshot()
    assert out["written"] == ["runs/r2@1"] and out["skipped"] == ["runs/r1: session.sqlite: database is locked"]
    assert not (volume / "runs" / "r1").exists()  # no half unit: the event log is not stored without its database
    monkeypatch.undo()
    assert p.snapshot()["written"] == ["runs/r1@1"]


def test_names_that_are_not_safe_and_links_are_left_alone(tmp_path: Path) -> None:
    p, local, volume, _ = make(tmp_path)
    (tmp_path / "outside").mkdir()
    (tmp_path / "outside" / "secret.txt").write_text("not ours")
    (local / "runs" / "ok").mkdir()
    (local / "runs" / "ok" / "a.txt").write_text("a")
    os.symlink(tmp_path / "outside", local / "runs" / "ok" / "link")
    os.symlink(tmp_path / "outside", local / "runs" / "linked-run")
    (local / "runs" / "bad name").mkdir()
    (local / "runs" / "gen-00000001").mkdir()
    assert p.snapshot()["written"] == ["runs/ok@1"]
    stored = [f for f in volume.rglob("*") if f.is_file()]
    assert len(stored) == 1 and members(stored[0]) == ["a.txt"]
    # A tar that tries to write outside the unit, or that holds a link, is refused whole.
    for build in ("escape", "link"):
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w") as tar:
            info = tarfile.TarInfo("../../escaped.txt" if build == "escape" else "link")
            if build == "link":
                info.type, info.linkname = tarfile.SYMTYPE, "/etc/passwd"
            tar.addfile(info, io.BytesIO(b"") if build == "escape" else None)
        stored[0].unlink()
        stored[0] = stored[0].parent / f"gen-00000009-{persist._name_hash(buffer.getvalue())}.tar"
        stored[0].write_bytes(buffer.getvalue())
        q, second = fresh(tmp_path, build)
        out = q.restore()
        assert out["lost"] == ["runs/ok"] and "not a plain file inside the unit" in out["rejected"][0]
        assert not (second / "runs" / "ok").exists() and not list(tmp_path.rglob("escaped.txt"))


def test_restore_replaces_the_files_the_image_came_with(tmp_path: Path) -> None:
    p, local, _volume, _ = make(tmp_path)
    (local / "notes").mkdir()
    (local / "notes" / "scout.md").write_text("learned in a run")
    p.snapshot()
    q, second = fresh(tmp_path)
    (second / "notes").mkdir(parents=True)
    (second / "notes" / "scout.md").write_text("as shipped")
    (second / "notes" / "old.md").write_text("as shipped")
    q.restore()
    assert (second / "notes" / "scout.md").read_text() == "learned in a run" and not (second / "notes" / "old.md").exists()


def start_writer(run: Path, delay: float = 0.0) -> subprocess.Popen:
    child = subprocess.Popen([sys.executable, str(WRITER), str(run), str(delay)])
    deadline = time.time() + 10
    while not (run / "ready").exists():
        assert time.time() < deadline and child.poll() is None
        time.sleep(0.01)
    return child


def freezer(pid: int):
    @contextlib.contextmanager
    def freeze():
        os.kill(pid, signal.SIGSTOP)
        try:
            yield
        finally:
            os.kill(pid, signal.SIGCONT)
    return freeze


def test_snapshots_of_a_busy_writer_are_each_a_state_it_could_have_crashed_in(tmp_path: Path) -> None:
    """The writer commits row N, then appends event N, then writes run.json. Paused at any instant, the three differ by at most one step."""
    p, local, volume, _ = make(tmp_path)
    run = local / "runs" / "live"
    child = start_writer(run)
    p.freeze = freezer(child.pid)
    try:
        seen = []
        for round_ in range(40):
            time.sleep(0.02)
            out = p.snapshot()
            if out["skipped"]:  # run.json was caught between "emptied" and "written": not stored, tried again
                assert out["written"] == [] and "is being written" in out["skipped"][0]
                continue
            assert len(out["written"]) == 1
            q, copy = fresh(tmp_path, f"copy{round_}")
            q.restore()
            rows = rows_of(copy / "runs" / "live" / "session.sqlite")
            events = [json.loads(line)["n"] for line in (copy / "runs" / "live" / "events.jsonl").read_text().splitlines()]
            state = json.loads((copy / "runs" / "live" / "run.json").read_text())["steps"]
            assert events == list(range(1, len(events) + 1))
            assert rows - 1 <= len(events) <= rows and len(events) - 1 <= state <= len(events), (rows, len(events), state)
            seen.append(rows)
        assert len(seen) >= 20 and seen == sorted(seen) and seen[-1] > seen[0]  # the writer went on between snapshots
    finally:
        child.kill()
        child.wait()


def test_a_writer_killed_without_warning_leaves_a_wal_and_nothing_committed_is_lost(tmp_path: Path) -> None:
    p, local, _volume, _ = make(tmp_path)
    run = local / "runs" / "live"
    child = start_writer(run, delay=0.001)
    time.sleep(0.3)
    child.kill()  # SIGKILL: no checkpoint, the newest rows are only in session.sqlite-wal
    child.wait()
    assert (run / "session.sqlite-wal").stat().st_size > 0
    events = len((run / "events.jsonl").read_text().splitlines())
    assert p.snapshot()["written"] == ["runs/live@1"]
    q, second = fresh(tmp_path)
    q.restore()
    rows = rows_of(second / "runs" / "live" / "session.sqlite")
    assert rows >= events > 0 and rows - events <= 1
    again = start_writer(second / "runs" / "live")  # and the writer continues from the copy
    time.sleep(0.1)
    again.kill()
    again.wait()
    assert sqlite3.connect(second / "runs" / "live" / "session.sqlite").execute("SELECT COUNT(*) FROM steps").fetchone()[0] > rows


def test_a_json_file_caught_half_written_is_not_stored(tmp_path: Path) -> None:
    p, local, volume, _ = make(tmp_path)
    run = local / "runs" / "r1"
    run.mkdir()
    (run / "run.json").write_text('{"usd": 1.25}')
    p.snapshot()
    (run / "run.json").write_text("")  # the engine was paused right after it emptied the file
    out = p.snapshot()
    assert out["written"] == [] and out["skipped"] == ["runs/r1: run.json is being written"]
    (run / "run.json").write_text('{"usd": 1.5}')
    assert p.snapshot()["written"] == ["runs/r1@2"]
    q, second = fresh(tmp_path)
    q.restore()
    assert json.loads((second / "runs" / "r1" / "run.json").read_text()) == {"usd": 1.5}


def test_a_collection_inside_another_is_stored_one_folder_at_a_time(tmp_path: Path) -> None:
    """Research answers live in board/runs/.research/<id>/. One answer changing must not rewrite all the others."""
    local, volume = tmp_path / "local", tmp_path / "volume" / "v1"
    p = Persister({"runs": local / "runs", "answers": local / "runs" / ".research"}, volume, log=lambda _line: None)
    for name in ("a-1", "a-2"):
        (local / "runs" / ".research" / name).mkdir(parents=True)
        (local / "runs" / ".research" / name / "record.json").write_text("{}")
    (local / "runs" / "r1").mkdir()
    (local / "runs" / "r1" / "run.json").write_text("{}")
    assert sorted(p.snapshot()["written"]) == ["answers/a-1@1", "answers/a-2@1", "runs/r1@1"]
    assert not (volume / "runs" / ".research").exists()
    (local / "runs" / ".research" / "a-2" / "record.json").write_text('{"done": true}')
    assert p.snapshot()["written"] == ["answers/a-2@2"]
    second = tmp_path / "second"
    q = Persister({"runs": second / "runs", "answers": second / "runs" / ".research"}, volume, log=lambda _line: None)
    assert sorted(q.restore()["restored"]) == ["answers/a-1@1", "answers/a-2@2", "runs/r1@1"]
    assert (second / "runs" / ".research" / "a-2" / "record.json").read_text() == '{"done": true}' and (second / "runs" / "r1" / "run.json").exists()
