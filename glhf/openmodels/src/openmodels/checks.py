"""Checks made against a served model before any benchmark run uses it.

`key_check`: every path must refuse a request without the key and with a wrong key.
`tool_check`: a real tool-call round trip, in the form Inspect sends it (function tools with
`strict`, the tool result sent back as a `tool` message). The agents cannot work without it.
`speed`: output tokens per second on one plain request."""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from typing import Any

from .serve import Http, ServeError, http

OPEN_PATHS = (
    ("GET", "/v1/models"),
    ("GET", "/health"),
    ("GET", "/metrics"),
    ("GET", "/docs"),
    ("POST", "/v1/chat/completions"),
    ("POST", "/v1/completions"),
    ("POST", "/invocations"),
    ("POST", "/tokenize"),
)
TOOL = {
    "type": "function",
    "function": {
        "name": "submit_answer",
        "description": "Record the answer to a question.",
        "parameters": {
            "type": "object",
            "properties": {
                "question_id": {"type": "string", "description": "The id of the question."},
                "answer": {
                    "type": "string",
                    "description": "The answer: digits only for a number.",
                },
            },
            "required": ["question_id", "answer"],
            "additionalProperties": False,
        },
        "strict": True,
    },
}


def key_check(url: str, key: str, request: Http = http) -> dict[str, Any]:
    """Without the key and with a wrong key every path must answer 401 or 403; with the key the
    model list must answer 200. `ok` is False if any path answered an unauthenticated request."""
    wrong = {"Authorization": "Bearer wk-wrong.ws-wrong"}
    results: dict[str, Any] = {"paths": {}}
    ok = True
    for method, path in OPEN_PATHS:
        body = {} if method == "POST" else None
        none_status, _ = request(method, url + path, {}, body, 30.0)
        wrong_status, _ = request(method, url + path, wrong, body, 30.0)
        results["paths"][f"{method} {path}"] = {"no_key": none_status, "wrong_key": wrong_status}
        ok = ok and none_status in (401, 403) and wrong_status in (401, 403)
    with_key, _ = request("GET", url + "/v1/models", {"Authorization": f"Bearer {key}"}, None, 30.0)
    results["with_key"] = with_key
    results["ok"] = ok and with_key == 200
    return results


def _chat(url: str, key: str, body: dict[str, Any], request: Http) -> tuple[dict[str, Any], float]:
    started = time.monotonic()
    status, reply = request(
        "POST", url + "/v1/chat/completions", {"Authorization": f"Bearer {key}"}, body, 600.0
    )
    seconds = time.monotonic() - started
    if status != 200 or not isinstance(reply, dict):
        raise ServeError(f"chat completion answered {status}: {str(reply)[:300]}")
    return reply, seconds


def tool_check(url: str, key: str, model: str, request: Http = http) -> dict[str, Any]:
    """Ask for a tool call, check it is a parsed call with valid JSON arguments and the right
    value, send the tool's result back and check the model then answers in text."""
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": "You answer by calling the tool you are given."},
        {
            "role": "user",
            "content": "Question q1: what is 17 + 25? Record the answer with submit_answer.",
        },
    ]
    body = {"model": model, "messages": messages, "tools": [TOOL], "tool_choice": "auto", "seed": 0}
    reply, seconds = _chat(url, key, body, request)
    choice = reply["choices"][0]
    calls = choice["message"].get("tool_calls") or []
    result: dict[str, Any] = {
        "finish_reason": choice.get("finish_reason"),
        "calls": len(calls),
        "seconds": round(seconds, 2),
        "usage": reply.get("usage"),
        "ok": False,
    }
    if not calls:
        result["problem"] = (
            "no parsed tool call; content began: " + str(choice["message"].get("content"))[:160]
        )
        return result
    function = calls[0].get("function", {})
    result["name"] = function.get("name")
    try:
        arguments = json.loads(function.get("arguments") or "")
    except json.JSONDecodeError:
        result["problem"] = "the arguments are not JSON"
        return result
    result["arguments"] = arguments
    if function.get("name") != "submit_answer" or str(arguments.get("answer")).strip() != "42":
        result["problem"] = "wrong tool or wrong value"
        return result
    # Second turn: the assistant message goes back as received, then the tool's result.
    messages.append(choice["message"])
    messages.append(
        {"role": "tool", "tool_call_id": calls[0].get("id"), "content": "recorded q1 = 42"}
    )
    messages.append({"role": "user", "content": "Reply with the single word done."})
    reply2, seconds2 = _chat(
        url, key, {"model": model, "messages": messages, "tools": [TOOL], "seed": 0}, request
    )
    text = str(reply2["choices"][0]["message"].get("content") or "")
    result["second_turn"] = text.strip()[:80]
    result["second_turn_seconds"] = round(seconds2, 2)
    result["ok"] = "done" in text.lower()
    if not result["ok"]:
        result["problem"] = "no text answer after the tool result"
    return result


def speed(
    url: str,
    key: str,
    model: str,
    request: Http = http,
    clock: Callable[[], float] = time.monotonic,
) -> dict[str, Any]:
    """Output tokens per second on one request of about 400 output tokens, one at a time. The
    time includes reading the short prompt, so it is a little under the decode speed."""
    body = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": "Explain, in about 300 words, how DESeq2 estimates dispersion.",
            }
        ],
        "max_tokens": 600,
        "seed": 0,
    }
    started = clock()
    reply, _ = _chat(url, key, body, request)
    seconds = clock() - started
    usage = reply.get("usage") or {}
    out = int(usage.get("completion_tokens") or 0)
    return {
        "completion_tokens": out,
        "prompt_tokens": usage.get("prompt_tokens"),
        "seconds": round(seconds, 2),
        "tokens_per_second": round(out / seconds, 1) if seconds > 0 else None,
    }
