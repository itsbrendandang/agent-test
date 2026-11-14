"""Long-term memory in past.dev (https://past.dev), used when PAST_API_KEY is set on the runner.

Calls follow the Memory API quickstart: POST /ingest with id, content, label and timestamp, and
POST /recall with query, identity and level. Only lessons a person approved (memory.py, `approve`)
are sent, never what a run has just written: no inputs, outputs, results or scores, and no text
of the task brief (the recall query is a fixed sentence). Recalled text that came from a run on
the same task, or from a run that had read this task's lessons, is dropped, and what remains
passes the same filter before any role sees it. A failure here never fails a run; the local file
remains.
"""

from __future__ import annotations

import os
import re
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

import httpx

from .memory import lesson_rejection

API = "https://api.past.dev/api/v1"
IDENTITY = "glhf-swarm"
KEY_ENV = "PAST_API_KEY"
# Fixed on purpose: the task brief is gated benchmark content and is never sent to a third party.
RECALL_QUERY = (
    "Process lessons for reproducing a computational biology analysis from raw data: environment "
    "and tool problems and their fixes, file format pitfalls, and what took the most time."
)


def enabled() -> bool:
    return bool(os.environ.get(KEY_ENV))


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {os.environ[KEY_ENV]}", "Content-Type": "application/json"}


def _source_id(task_id: str, stamp: str = "") -> str:
    return f"glhf-lessons-{task_id}-{stamp}"


_CONTEXT = "; context: "


async def remember(task_id: str, lessons: str, context: Sequence[str] = ()) -> str:
    """Send one run's approved lessons as one data point. Returns the ingestion id.

    `context` (tasks whose lessons the writing run had read) goes in the label, so recall can
    keep these lessons away from those tasks too."""
    now = datetime.now(UTC)
    label = f"GLHF swarm lessons, task {task_id}"
    if context:
        label += _CONTEXT + ", ".join(f"task {c}" for c in context)
    payload = {
        "id": _source_id(task_id, now.strftime("%Y%m%dT%H%M%SZ")),
        "content": f"Process lessons from a GLHF swarm run on task {task_id}:\n{lessons.strip()}",
        "label": label,
        "timestamp": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(f"{API}/ingest", headers=_headers(), json=payload)
    response.raise_for_status()
    return str(response.json().get("ingestionId", ""))


_TASK = re.compile(r"(?<![A-Za-z])task ([\w.-]+)", re.IGNORECASE)
_SOURCE = re.compile(r"^glhf-lessons-(.+)-\d{8}T\d{6}Z$")


def tasks_of(result: dict[str, Any]) -> set[str]:
    """Every task a recalled item names: in its text, its source ids and its labels (which carry
    the writing task and that run's context)."""
    found = set(_TASK.findall(str(result.get("content", ""))))
    for source in result.get("sources") or []:
        if not isinstance(source, dict):
            continue
        match = _SOURCE.match(str(source.get("sourceId", "")))
        if match:
            found.add(match.group(1))
        found |= set(_TASK.findall(str(source.get("label", ""))))
    return {t.rstrip(".:,;") for t in found}


def from_task(result: dict[str, Any], task_id: str) -> bool:
    """True when a recalled item was built from a run on `task_id`, or from a run that had read
    that task's lessons (by source id, label or text)."""
    return str(task_id) in tasks_of(result)


async def recall_with_sources(
    question: str = RECALL_QUERY, task_id: str | None = None, limit_chars: int = 4000
) -> tuple[str, set[str]]:
    """Lessons from runs on other tasks, as past.dev returns them, filtered, and the tasks they
    came from. Empty if none."""
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{API}/recall",
            headers=_headers(),
            json={"query": question, "identity": IDENTITY, "level": "medium"},
        )
    response.raise_for_status()
    results: list[dict[str, Any]] = response.json().get("results", [])
    lines: list[str] = []
    sources: set[str] = set()
    size = 0
    for result in results:
        if task_id is not None and from_task(result, str(task_id)):
            continue
        for line in str(result.get("content", "")).splitlines():
            line = line.strip()
            if not line or lesson_rejection(line) or line in lines:
                continue
            if size + len(line) + 1 > limit_chars:
                return "\n".join(lines), sources
            lines.append(line)
            size += len(line) + 1
            sources |= tasks_of(result)
    return "\n".join(lines), sources


async def recall(
    question: str = RECALL_QUERY, task_id: str | None = None, limit_chars: int = 4000
) -> str:
    text, _ = await recall_with_sources(question, task_id, limit_chars)
    return text
