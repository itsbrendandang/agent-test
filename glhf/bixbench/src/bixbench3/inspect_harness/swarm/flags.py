"""Switches for the claims engine, so the swarm can be compared with parts of it turned off.

The critic is never off: every claims run has a critic, because it is the role that tests each
claim independently and no other role registers tests.

The ablations never change the run's budget: a role that is off spends nothing, and what it would
have spent stays with the claims. Every run logs its flags (`Board.event("flags", ...)`).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

DEFAULT_MAX_PARALLEL = 2
DEFAULT_REVIEW_ROUNDS = 2  # the claims engine's cap; the phase engine keeps its own default


@dataclass(frozen=True)
class SwarmFlags:
    auditor: bool = True
    pilot: bool = True
    retriage: bool = True
    max_parallel: int = DEFAULT_MAX_PARALLEL
    review_rounds: int = DEFAULT_REVIEW_ROUNDS

    def __post_init__(self) -> None:
        if self.max_parallel < 1:
            raise ValueError("max_parallel must be at least 1")
        if not 0 <= self.review_rounds <= 5:
            raise ValueError("review_rounds must be between 0 and 5")

    @classmethod
    def from_options(
        cls,
        *,
        no_auditor: bool = False,
        no_pilot: bool = False,
        no_retriage: bool = False,
        max_parallel: int = DEFAULT_MAX_PARALLEL,
        review_rounds: int = DEFAULT_REVIEW_ROUNDS,
    ) -> SwarmFlags:
        return cls(
            auditor=not no_auditor,
            pilot=not no_pilot,
            retriage=not no_retriage,
            max_parallel=max_parallel,
            review_rounds=review_rounds,
        )

    @property
    def review(self) -> bool:
        """Any review at all: rounds planned (the critic is always on)."""
        return self.review_rounds > 0

    def event(self) -> dict[str, Any]:
        return asdict(self)
