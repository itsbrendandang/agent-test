"""Provider-agnostic LLM client.

Provider is chosen from environment: ANTHROPIC_API_KEY -> anthropic,
OPENAI_API_KEY -> openai. Model name from MODEL_NAME env or explicit arg.

Internally messages/tools use Anthropic-style content blocks; translated for
OpenAI. Every call records token usage into the provided Budget and raises
BudgetExhausted beforehand if a cap is already hit.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from typing import Any

from .budget import Budget

DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5"
DEFAULT_OPENAI_MODEL = "gpt-5.1"
MAX_COMPLETION_TOKENS = 8192
_RETRIES = 3
# Baseline gpt-5.1 calls took at most 16 s; a silent stall otherwise waits for the SDK default of 600 s.
_REQUEST_TIMEOUT_S = float(os.environ.get("BIXBASE_REQUEST_TIMEOUT_S", "60"))


@dataclass
class ToolCall:
    id: str
    name: str
    input: dict[str, Any]


@dataclass
class LLMResponse:
    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    stop_reason: str = ""
    input_tokens: int = 0
    output_tokens: int = 0


def detect_provider() -> str:
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic"
    if os.environ.get("OPENAI_API_KEY"):
        return "openai"
    raise RuntimeError(
        "no model credentials found: set ANTHROPIC_API_KEY or OPENAI_API_KEY"
    )


def default_model(provider: str) -> str:
    return os.environ.get(
        "MODEL_NAME",
        DEFAULT_ANTHROPIC_MODEL if provider == "anthropic" else DEFAULT_OPENAI_MODEL,
    )


class LLMClient:
    """Thin wrapper over anthropic/openai SDKs with budget accounting."""

    def __init__(
        self,
        model: str | None = None,
        provider: str | None = None,
        *,
        seed: int | None = None,
        max_tokens: int = MAX_COMPLETION_TOKENS,
    ):
        self.provider = provider or detect_provider()
        self.model = model or default_model(self.provider)
        self.seed = seed
        self.max_tokens = max_tokens
        if self.provider == "anthropic":
            import anthropic

            self._client = anthropic.Anthropic(timeout=_REQUEST_TIMEOUT_S)
        elif self.provider == "openai":
            import openai

            self._client = openai.OpenAI(timeout=_REQUEST_TIMEOUT_S)
        else:
            raise ValueError(f"unknown provider {self.provider!r}")

    # -- public API ---------------------------------------------------------

    def chat(
        self,
        messages: list[dict],
        *,
        system: str | None = None,
        tools: list[dict] | None = None,
        budget: Budget,
        enforce_budget: bool = True,
    ) -> LLMResponse:
        """One tool-use chat turn. Raises BudgetExhausted if caps are hit.

        enforce_budget=False is reserved for the single forced final-answer
        call after exhaustion; usage is still recorded."""
        if enforce_budget:
            budget.raise_if_exhausted()
        if self.provider == "anthropic":
            resp = self._chat_anthropic(messages, system, tools)
        else:
            resp = self._chat_openai(messages, system, tools)
        budget.record_usage(resp.input_tokens, resp.output_tokens)
        return resp

    def complete(self, prompt: str, *, budget: Budget) -> str:
        """Plain completion (used by the LLM judge)."""
        resp = self.chat(
            [{"role": "user", "content": prompt}], system=None, tools=None,
            budget=budget,
        )
        return resp.text

    # -- anthropic ----------------------------------------------------------

    def _chat_anthropic(self, messages, system, tools) -> LLMResponse:
        kwargs: dict[str, Any] = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": messages,
        }
        if system:
            kwargs["system"] = system
        if tools:
            kwargs["tools"] = tools
        resp = self._with_retries(lambda: self._client.messages.create(**kwargs))
        text_parts, calls = [], []
        for block in resp.content:
            if block.type == "text":
                text_parts.append(block.text)
            elif block.type == "tool_use":
                calls.append(ToolCall(id=block.id, name=block.name, input=block.input))
        return LLMResponse(
            text="".join(text_parts),
            tool_calls=calls,
            stop_reason=resp.stop_reason or "",
            input_tokens=resp.usage.input_tokens,
            output_tokens=resp.usage.output_tokens,
        )

    # -- openai -------------------------------------------------------------

    def _chat_openai(self, messages, system, tools) -> LLMResponse:
        oai_messages = self._to_openai_messages(messages, system)
        kwargs: dict[str, Any] = {"model": self.model, "messages": oai_messages}
        if tools:
            kwargs["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": t["name"],
                        "description": t.get("description", ""),
                        "parameters": t["input_schema"],
                    },
                }
                for t in tools
            ]
        if self.seed is not None:
            kwargs["seed"] = self.seed
        resp = self._with_retries(
            lambda: self._client.chat.completions.create(**kwargs)
        )
        msg = resp.choices[0].message
        calls = []
        for tc in msg.tool_calls or []:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {"_raw": tc.function.arguments}
            calls.append(ToolCall(id=tc.id, name=tc.function.name, input=args))
        usage = resp.usage
        return LLMResponse(
            text=msg.content or "",
            tool_calls=calls,
            stop_reason=resp.choices[0].finish_reason or "",
            input_tokens=usage.prompt_tokens if usage else 0,
            output_tokens=usage.completion_tokens if usage else 0,
        )

    @staticmethod
    def _to_openai_messages(messages, system):
        out = []
        if system:
            out.append({"role": "system", "content": system})
        for m in messages:
            role, content = m["role"], m["content"]
            if isinstance(content, str):
                out.append({"role": role, "content": content})
                continue
            if role == "assistant":
                texts = [b["text"] for b in content if b["type"] == "text"]
                tcs = [
                    {
                        "id": b["id"],
                        "type": "function",
                        "function": {
                            "name": b["name"],
                            "arguments": json.dumps(b["input"]),
                        },
                    }
                    for b in content
                    if b["type"] == "tool_use"
                ]
                msg: dict[str, Any] = {
                    "role": "assistant",
                    "content": "".join(texts) or None,
                }
                if tcs:
                    msg["tool_calls"] = tcs
                out.append(msg)
            elif role == "user":
                # tool_result blocks become role:"tool" messages; text stays user
                for b in content:
                    if b["type"] == "tool_result":
                        out.append(
                            {
                                "role": "tool",
                                "tool_call_id": b["tool_use_id"],
                                "content": b["content"]
                                if isinstance(b["content"], str)
                                else json.dumps(b["content"]),
                            }
                        )
                    else:
                        out.append({"role": "user", "content": b.get("text", "")})
        return out

    # -- helpers ------------------------------------------------------------

    def _with_retries(self, fn):
        last = None
        for attempt in range(_RETRIES):
            try:
                return fn()
            except Exception as e:  # noqa: BLE001 - retry transient API errors
                last = e
                if not _is_transient(e) or attempt == _RETRIES - 1:
                    raise
                time.sleep(2**attempt)
        raise last


def _is_transient(e: Exception) -> bool:
    status = getattr(e, "status_code", None) or getattr(
        getattr(e, "response", None), "status_code", None
    )
    return status in {408, 409, 425, 429, 500, 502, 503, 504} or isinstance(
        e, (TimeoutError, ConnectionError)
    )
