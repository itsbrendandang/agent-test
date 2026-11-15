"""Fakes shared by the tests: the `modal` command, the served model, a clock."""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

from openmodels import registry, serve

REPO_REGISTRY = registry.load()
QWEN = REPO_REGISTRY.get("qwen3.6-35b-a3b")
URL = "https://ws--openmodels-qwen36-35b-a3b-server.us-east.modal.direct"
KEY = "wk-testid.ws-testsecret"


class FakeModal:
    """Stands in for the `modal` command: records every command, keeps a set of live apps."""

    def __init__(self, stop_works: bool = True, deploy_code: int = 0) -> None:
        self.commands: list[list[str]] = []
        self.live: set[str] = set()
        self.stop_works = stop_works
        self.deploy_code = deploy_code

    def __call__(self, command: Sequence[str]) -> serve.Done:
        command = list(command)
        self.commands.append(command)
        if command[:2] == ["modal", "deploy"]:
            if self.deploy_code == 0:
                self.live.add(QWEN.app_name or "")
            return serve.Done(self.deploy_code, "", "build failed" if self.deploy_code else "")
        if command[:3] == ["modal", "server", "info"]:
            return serve.Done(0, json.dumps({"url": URL}))
        if command[:3] == ["modal", "app", "stop"]:
            if self.stop_works:
                self.live.discard(command[-1])
            return serve.Done(0, "")
        if command[:3] == ["modal", "app", "list"]:
            return serve.Done(
                0,
                json.dumps(
                    [
                        {"App ID": "ap-1", "Description": n, "State": "deployed"}
                        for n in sorted(self.live)
                    ]
                ),
            )
        raise AssertionError(f"unexpected command {command}")

    def verbs(self) -> list[str]:
        return [c[1] if c[1] == "deploy" else " ".join(c[1:3]) for c in self.commands]


class FakeEndpoint:
    """Stands in for the served model. `open_without_key` makes it answer a request that has no
    key; `tools` False makes it answer in text when asked for a tool call."""

    def __init__(
        self, open_without_key: bool = False, tools: bool = True, cold_503: int = 2
    ) -> None:
        self.requests: list[tuple[str, str, bool]] = []
        self.open_without_key = open_without_key
        self.tools = tools
        self.cold_503 = cold_503

    def __call__(
        self, method: str, url: str, headers: dict[str, str], body: Any, timeout: float
    ) -> tuple[int, Any]:
        authorised = headers.get("Authorization") == f"Bearer {KEY}"
        self.requests.append((method, url.removeprefix(URL), authorised))
        if not authorised:
            return (200, {"data": []}) if self.open_without_key else (401, "missing credentials")
        if url.endswith("/v1/models"):
            if self.cold_503 > 0:
                self.cold_503 -= 1
                return 503, "no container"
            return 200, {"data": [{"id": QWEN.hf_repo}]}
        messages = body["messages"]
        usage = {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150}
        if messages[-1]["content"].startswith("Reply with"):
            return 200, {
                "choices": [
                    {"message": {"role": "assistant", "content": "done"}, "finish_reason": "stop"}
                ],
                "usage": usage,
            }
        if "tools" in body and self.tools:
            call = {
                "id": "call-1",
                "type": "function",
                "function": {
                    "name": "submit_answer",
                    "arguments": json.dumps({"question_id": "q1", "answer": "42"}),
                },
            }
            return 200, {
                "choices": [
                    {
                        "message": {"role": "assistant", "content": None, "tool_calls": [call]},
                        "finish_reason": "tool_calls",
                    }
                ],
                "usage": usage,
            }
        return 200, {
            "choices": [
                {
                    "message": {"role": "assistant", "content": "<tool_call>submit_answer 42"},
                    "finish_reason": "stop",
                }
            ],
            "usage": usage,
        }


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds
