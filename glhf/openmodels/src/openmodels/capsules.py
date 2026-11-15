"""The fixed capsule list of the grid: a seeded draw, recorded in capsules.json.

Rule, fixed before the draw was made: the pool is every capsule of the question file except the
capsules of the earlier pilot (the folder names under runs/pilot-sonnet-5-5); 20 are drawn
without replacement by `random.Random(SEED).sample` from the pool sorted by key. Nothing about a
question's text or answer enters the draw: only capsule keys do. One draw was made; it was not
repeated to get a nicer list."""

from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

from .registry import ROOT

LIST_FILE = ROOT / "capsules.json"
SEED = 20261114
COUNT = 20


def pilot_capsules(pilot_dir: Path) -> list[str]:
    """The capsules the pilot ran: its run folder's sub-folders."""
    return sorted(p.name for p in pilot_dir.iterdir() if p.is_dir())


def draw(pool: list[str], seed: int = SEED, count: int = COUNT) -> list[str]:
    """`count` capsule keys from the pool. The pool is sorted first, so its order on disk or in
    the question file cannot change the result."""
    ordered = sorted(set(pool))
    if count > len(ordered):
        raise ValueError(f"cannot draw {count} from {len(ordered)} capsules")
    return sorted(random.Random(seed).sample(ordered, count))


def record(
    questions: dict[str, int], excluded: list[str], seed: int = SEED, count: int = COUNT
) -> dict[str, Any]:
    """The draw with everything needed to repeat it: the pool with question counts, the excluded
    capsules, the seed, the result."""
    pool = sorted(key for key in questions if key not in set(excluded))
    chosen = draw(pool, seed, count)
    return {
        "rule": "random.Random(seed).sample(sorted(pool), count), result sorted; pool = all "
        "capsules of the question file minus `excluded` (the earlier pilot)",
        "seed": seed,
        "count": count,
        "excluded": sorted(excluded),
        "pool": {key: questions[key] for key in pool},
        "capsules": chosen,
        "questions": sum(questions[key] for key in chosen),
    }


def load(path: Path = LIST_FILE) -> tuple[list[str], dict[str, int]]:
    """(capsule keys, question count per key) from capsules.json, or from a plain text file with
    one capsule key per line (counts then unknown: empty dict)."""
    text = path.read_text(encoding="utf-8")
    if path.suffix == ".json":
        data = json.loads(text)
        keys = [str(k) for k in data["capsules"]]
        counts = {k: int(v) for k, v in (data.get("pool") or {}).items() if k in keys}
        return keys, counts
    keys = [line.strip() for line in text.splitlines() if line.strip() and not line.startswith("#")]
    return keys, {}
