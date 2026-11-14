"""Budget accounting for agent runs.

Every model call and every tool call goes through a Budget object. When any
cap is hit, `raise_if_exhausted` raises BudgetExhausted, which the agent loop
converts into a forced final answer.

The same class must back the multi-agent swarm: pass one shared Budget to all
sub-agents to enforce a global cap, or per-agent budgets for local caps.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field


class BudgetExhausted(Exception):
    """Raised when a budget cap is hit. The loop should force a final answer."""

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(f"budget exhausted: {reason}")


@dataclass
class BudgetCaps:
    """Configurable caps. None means uncapped."""

    max_input_tokens: int | None = None
    max_output_tokens: int | None = None
    max_total_tokens: int | None = None  # input + output combined
    max_tool_calls: int | None = None
    max_seconds: float | None = None

    @classmethod
    def from_total_tokens(
        cls,
        tokens: int | None,
        *,
        max_tool_calls: int | None = None,
        max_seconds: float | None = None,
    ) -> "BudgetCaps":
        """Helper for the `--budget-tokens` CLI flag: a combined token cap."""
        return cls(
            max_total_tokens=tokens,
            max_tool_calls=max_tool_calls,
            max_seconds=max_seconds,
        )


@dataclass
class Budget:
    """Tracks consumption against caps for one solve() call (or one swarm)."""

    caps: BudgetCaps = field(default_factory=BudgetCaps)
    input_tokens: int = 0
    output_tokens: int = 0
    tool_calls: int = 0
    model_calls: int = 0
    _start: float = field(default_factory=time.monotonic)

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    @property
    def elapsed(self) -> float:
        return time.monotonic() - self._start

    def exhaustion_reason(self) -> str | None:
        """Return which cap is hit, or None if budget remains."""
        c = self.caps
        if c.max_input_tokens is not None and self.input_tokens >= c.max_input_tokens:
            return f"input_tokens {self.input_tokens} >= {c.max_input_tokens}"
        if (
            c.max_output_tokens is not None
            and self.output_tokens >= c.max_output_tokens
        ):
            return f"output_tokens {self.output_tokens} >= {c.max_output_tokens}"
        if (
            c.max_total_tokens is not None
            and self.total_tokens >= c.max_total_tokens
        ):
            return f"total_tokens {self.total_tokens} >= {c.max_total_tokens}"
        if c.max_tool_calls is not None and self.tool_calls >= c.max_tool_calls:
            return f"tool_calls {self.tool_calls} >= {c.max_tool_calls}"
        if c.max_seconds is not None and self.elapsed >= c.max_seconds:
            return f"wall_clock {self.elapsed:.1f}s >= {c.max_seconds}s"
        return None

    @property
    def exhausted(self) -> bool:
        return self.exhaustion_reason() is not None

    def raise_if_exhausted(self) -> None:
        reason = self.exhaustion_reason()
        if reason is not None:
            raise BudgetExhausted(reason)

    def record_usage(self, input_tokens: int, output_tokens: int) -> None:
        """Record one model call's token usage."""
        self.input_tokens += int(input_tokens or 0)
        self.output_tokens += int(output_tokens or 0)
        self.model_calls += 1

    def record_tool_call(self) -> None:
        self.tool_calls += 1

    def snapshot(self) -> dict:
        """JSON-serializable view for logs and result files."""
        return {
            "caps": {
                "max_input_tokens": self.caps.max_input_tokens,
                "max_output_tokens": self.caps.max_output_tokens,
                "max_total_tokens": self.caps.max_total_tokens,
                "max_tool_calls": self.caps.max_tool_calls,
                "max_seconds": self.caps.max_seconds,
            },
            "used": {
                "input_tokens": self.input_tokens,
                "output_tokens": self.output_tokens,
                "total_tokens": self.total_tokens,
                "tool_calls": self.tool_calls,
                "model_calls": self.model_calls,
            },
            "elapsed_seconds": round(self.elapsed, 3),
            "exhaustion_reason": self.exhaustion_reason(),
        }
