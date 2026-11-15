"""Cost estimates for the grid, with the arithmetic kept visible.

Vendor models: the pilot's measured tokens per question (runs/pilot-sonnet-5-5, Claude Sonnet,
8 questions, both solvers) times the number of questions, priced with the per-million-token
prices in models.yaml. A model served on Modal: measured seconds per question times the price of
its container per second. Every figure is an estimate from 8 pilot questions on 3 small
capsules; a different model uses different numbers of tokens."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .registry import Model

KINDS = ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens")


def pilot_usage(pilot_dir: Path) -> dict[str, dict[str, float]]:
    """Per solver: the pilot's token sums by kind, the questions and the seconds. Read from each
    run.json (settings and usage only; no answer is read)."""
    sums: dict[str, dict[str, float]] = {}
    for run_file in sorted(pilot_dir.glob("*/*/run.json")):
        run = json.loads(run_file.read_text(encoding="utf-8"))
        solver = str(run["settings"]["solver"])
        mine = sums.setdefault(solver, dict.fromkeys((*KINDS, "questions", "seconds", "runs"), 0.0))
        for usage in (run.get("usage") or {}).values():
            for kind in KINDS:
                mine[kind] += float(usage.get(kind) or 0)
        mine["questions"] += len(run["question_ids"])
        mine["seconds"] += float(run.get("seconds") or 0)
        mine["runs"] += 1
    return sums


def api_cell(pilot: dict[str, float], questions: int, model: Model) -> dict[str, Any]:
    """Dollars for one (vendor model, solver) cell of `questions` questions.

    `expected`: the pilot's tokens per question at this model's prices. Anthropic bills cache
    writes at their own price; for a vendor with no cache-write price (`cache_write` missing) the
    pilot's cache-write tokens are billed as plain input. `no_cache`: the same tokens with no
    cache hit at all (every input token at the full input price), a ceiling for the same work."""
    price = model.usd_per_mtok
    scale = questions / pilot["questions"]
    fresh = pilot["input_tokens"] + pilot["cache_write_tokens"]
    write_price = price.get("cache_write", price["input"])
    parts = {
        "input": pilot["input_tokens"] * scale * price["input"] / 1e6,
        "cache_write": pilot["cache_write_tokens"] * scale * write_price / 1e6,
        "cached_input": pilot["cache_read_tokens"] * scale * price["cached_input"] / 1e6,
        "output": pilot["output_tokens"] * scale * price["output"] / 1e6,
    }
    no_cache = (
        (fresh + pilot["cache_read_tokens"]) * scale * price["input"]
        + pilot["output_tokens"] * scale * price["output"]
    ) / 1e6
    return {
        "questions": questions,
        "scale": round(scale, 4),
        "tokens_per_question": {k: round(pilot[k] / pilot["questions"]) for k in KINDS},
        "usd_parts": {k: round(v, 2) for k, v in parts.items()},
        "expected_usd": round(sum(parts.values()), 2),
        "no_cache_usd": round(no_cache, 2),
    }


def gpu_cell(seconds_per_question: float, questions: int, rate_per_second: float) -> dict[str, Any]:
    """Dollars for one (Modal model, solver) cell: measured seconds per question, times the
    questions, times the container's price per second. The session's cold start and scaledown
    are added once per model by the caller."""
    seconds = seconds_per_question * questions
    return {
        "questions": questions,
        "seconds_per_question": round(seconds_per_question, 1),
        "seconds": round(seconds),
        "usd": round(seconds * rate_per_second, 2),
    }
