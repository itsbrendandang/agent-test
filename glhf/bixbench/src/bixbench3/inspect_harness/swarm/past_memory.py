"""Long-term memory in past.dev (https://past.dev), used when PAST_API_KEY is set on the runner.

Calls follow the Memory API quickstart: POST /ingest with id, content, label and timestamp, and
POST /recall with query, identity and level. Only process lessons are sent (see roles.LESSONS):
no inputs, outputs, results or scores. A failure here never fails a run; the local file remains.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import Any

import httpx

API = "https://api.past.dev/api/v1"
IDENTITY = "glhf-swarm"
KEY_ENV = "PAST_API_KEY"


def enabled() -> bool:
    return bool(os.environ.get(KEY_ENV))


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {os.environ[KEY_ENV]}", "Content-Type": "application/json"}


async def remember(task_id: str, lessons: str) -> str:
    """Send one run's lessons as one data point. Returns the ingestion id."""
    now = datetime.now(UTC)
    payload = {
        "id": f"glhf-lessons-{task_id}-{now.strftime('%Y%m%dT%H%M%SZ')}",
        "content": f"Process lessons from a GLHF swarm run on task {task_id}:\n{lessons.strip()}",
        "label": f"GLHF swarm lessons, task {task_id}",
        "timestamp": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(f"{API}/ingest", headers=_headers(), json=payload)
    response.raise_for_status()
    return str(response.json().get("ingestionId", ""))


async def recall(question: str, limit_chars: int = 4000) -> str:
    """Lessons relevant to `question`, newest wording as past.dev returns it. Empty if none."""
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{API}/recall",
            headers=_headers(),
            json={"query": question, "identity": IDENTITY, "level": "medium"},
        )
    response.raise_for_status()
    results: list[dict[str, Any]] = response.json().get("results", [])
    text = "\n".join(str(r.get("content", "")).strip() for r in results if r.get("content"))
    return text[:limit_chars]
