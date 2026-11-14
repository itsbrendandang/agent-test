"""Long-term memory in past.dev (https://past.dev), used when PAST_API_KEY is set on the runner.

Calls follow the Memory API quickstart: POST /ingest with id, content, label and timestamp, and
POST /recall with query, identity and level. Only process lessons that passed the filter in
memory.py are sent: no inputs, outputs, results or scores, and no text of the task brief (the
recall query is a fixed sentence). Recalled text from a run on the same task is dropped, and what
remains passes the same filter before any role sees it. A failure here never fails a run; the
local file remains.
"""

from __future__ import annotations

import os
import re
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


async def remember(task_id: str, lessons: str) -> str:
    """Send one run's (already filtered) lessons as one data point. Returns the ingestion id."""
    now = datetime.now(UTC)
    payload = {
        "id": _source_id(task_id, now.strftime("%Y%m%dT%H%M%SZ")),
        "content": f"Process lessons from a GLHF swarm run on task {task_id}:\n{lessons.strip()}",
        "label": f"GLHF swarm lessons, task {task_id}",
        "timestamp": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(f"{API}/ingest", headers=_headers(), json=payload)
    response.raise_for_status()
    return str(response.json().get("ingestionId", ""))


def from_task(result: dict[str, Any], task_id: str) -> bool:
    """True when a recalled item was built from a run on `task_id` (by source id, label or text)."""
    mention = re.compile(rf"\btask {re.escape(task_id)}(?![\w-])", re.IGNORECASE)
    if mention.search(str(result.get("content", ""))):
        return True
    for source in result.get("sources") or []:
        if not isinstance(source, dict):
            continue
        if str(source.get("sourceId", "")).startswith(_source_id(task_id)):
            return True
        if mention.search(str(source.get("label", ""))):
            return True
    return False


async def recall(
    question: str = RECALL_QUERY, task_id: str | None = None, limit_chars: int = 4000
) -> str:
    """Lessons from runs on other tasks, as past.dev returns them, filtered. Empty if none."""
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{API}/recall",
            headers=_headers(),
            json={"query": question, "identity": IDENTITY, "level": "medium"},
        )
    response.raise_for_status()
    results: list[dict[str, Any]] = response.json().get("results", [])
    lines: list[str] = []
    for result in results:
        if task_id is not None and from_task(result, str(task_id)):
            continue
        for line in str(result.get("content", "")).splitlines():
            line = line.strip()
            if line and not lesson_rejection(line) and line not in lines:
                lines.append(line)
    return "\n".join(lines)[:limit_chars]
