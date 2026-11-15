"""A model on our own OpenAI-compatible endpoint (`openai-api/<service>/<model>`, as served by
glhf/openmodels) goes through the same run path as any other model: Inspect sends chat
completions with tools to <SERVICE>_BASE_URL with <SERVICE>_API_KEY, and the token counts the
server reports land in run.json under the model's name.

No request leaves the process: `httpx.AsyncClient.send` is replaced by a scripted server that
answers the way vLLM does (tool calls, `usage`). Paid calls are allowed inside this test only,
with fake keys. Needs Docker for the sandbox, like test_e2e.py.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import Synthetic, docker_running

from bixbench_v1 import paid
from bixbench_v1.runner import grade_run, run_capsule

pytestmark = pytest.mark.skipif(not docker_running(), reason="Docker is not running")

MODEL = "openai-api/openmodels/stub/model-x"
BASE = "https://endpoint.invalid/v1"
KEY = "wk-fake.ws-fake"


def _tool(index: int, name: str, **arguments: Any) -> dict[str, Any]:
    return {
        "id": f"call-{index}",
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(arguments)},
    }


TINKER = "openai-api/tinker/Qwen/Qwen3.6-35B-A3B:peft:262144"  # a hosted service, same path


@pytest.mark.parametrize(
    ("model", "service", "sent_name"),
    [(MODEL, "OPENMODELS", "stub/model-x"), (TINKER, "TINKER", "Qwen/Qwen3.6-35B-A3B:peft:262144")],
)
def test_a_run_on_our_endpoint_records_its_tokens_like_any_other_model(
    synthetic: Synthetic,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    model: str,
    service: str,
    sent_name: str,
) -> None:
    monkeypatch.setenv(paid.SWITCH, "0")  # paid-allowed logic, fakes only
    monkeypatch.setenv(f"{service}_BASE_URL", BASE)
    monkeypatch.setenv(f"{service}_API_KEY", KEY)
    assert paid.isolate_endpoint([model], judge=False) is True  # what the command line does
    assert os.environ[f"{service}_API_KEY"] == KEY  # the service's own key is kept
    script = [
        _tool(1, "bash_session", action="type_submit", input="ls /data"),
        _tool(2, "submit_answer", question_id="syn-1-q1", answer="4", route="sum", evidence="x"),
        _tool(3, "submit_answer", question_id="syn-1-q2", answer="7", route="mean", evidence="x"),
        _tool(4, "submit", answer="done"),
    ]
    seen: list[dict[str, Any]] = []

    async def server(self: httpx.AsyncClient, request: httpx.Request, **_: Any) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(
            {
                "url": str(request.url),
                "auth": request.headers.get("authorization"),
                "model": body.get("model"),
                "tools": sorted(t["function"]["name"] for t in body.get("tools") or []),
                "seed": body.get("seed"),
            }
        )
        index = len(seen)
        message: dict[str, Any] = {"role": "assistant", "content": "all questions are answered"}
        finish = "stop"
        if index <= len(script):
            message = {"role": "assistant", "content": None, "tool_calls": [script[index - 1]]}
            finish = "tool_calls"
        reply = {
            "id": f"chatcmpl-{index}",
            "object": "chat.completion",
            "created": 0,
            "model": body.get("model"),
            "choices": [{"index": 0, "message": message, "finish_reason": finish}],
            "usage": {
                "prompt_tokens": 1000 * index,
                "completion_tokens": 40,
                "total_tokens": 1000 * index + 40,
            },
        }
        return httpx.Response(200, json=reply, request=request)

    monkeypatch.setattr(httpx.AsyncClient, "send", server)
    summary = run_capsule(
        synthetic.capsule,
        hub_dir=synthetic.hub,
        staged_root=synthetic.staged,
        out_dir=tmp_path / "run",
        solver="single",
        model=model,
        time_limit_seconds=300,
        max_tokens=500_000,
        seed=3,
        image="python:3.12-slim",
    )
    assert summary["status"] == "done", summary["error"]
    assert summary["settings"]["model"] == model
    # Every request went to the endpoint, with its key, the model's own name, tools and the seed.
    assert len(seen) >= len(script)
    assert {s["url"] for s in seen} == {BASE + "/chat/completions"}
    assert {s["auth"] for s in seen} == {f"Bearer {KEY}"}
    assert {s["model"] for s in seen} == {sent_name} and {s["seed"] for s in seen} == {3}
    assert "submit_answer" in seen[0]["tools"] and "bash_session" in seen[0]["tools"]
    # The server's usage is the run's usage, under the model's Inspect name.
    calls = len(seen)
    usage = summary["usage"][model]
    assert usage["output_tokens"] == 40 * calls
    assert usage["input_tokens"] == sum(1000 * i for i in range(1, calls + 1))
    assert usage["total_tokens"] == usage["input_tokens"] + usage["output_tokens"]
    assert summary["total_tokens"] == usage["total_tokens"]
    assert summary["answer_statuses"]["syn-1-q1"] == "unchecked"
    # Graded by code rules, with no judge.
    graded = grade_run(tmp_path / "run", synthetic.capsule, None)
    rows = {g["question_id"]: g for g in graded["profiles"]["per-mode"]["grades"]}
    assert rows["syn-1-q1"]["correct"] and not rows["syn-1-q2"]["correct"]
