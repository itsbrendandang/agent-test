"""A stand-in for the engine in the persistence tests: commits row N to a WAL database, then appends event N.

Usage: writer.py <run folder> [delay seconds]. Runs until it is killed. No network, no model.
"""
import json
import sqlite3
import sys
import time
from pathlib import Path

run = Path(sys.argv[1])
delay = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0
run.mkdir(parents=True, exist_ok=True)
db = sqlite3.connect(run / "session.sqlite", isolation_level=None)
db.execute("PRAGMA journal_mode=WAL")
db.execute("CREATE TABLE IF NOT EXISTS steps (n INTEGER PRIMARY KEY, body TEXT)")
n = db.execute("SELECT COALESCE(MAX(n), 0) FROM steps").fetchone()[0]
(run / "ready").write_text("1")
while True:
    n += 1
    db.execute("BEGIN IMMEDIATE")
    db.execute("INSERT INTO steps VALUES (?, ?)", (n, "x" * 200))
    db.execute("COMMIT")
    with (run / "events.jsonl").open("a") as events:
        events.write(json.dumps({"n": n}) + "\n")
    (run / "run.json").write_text(json.dumps({"steps": n}))
    if delay:
        time.sleep(delay)
