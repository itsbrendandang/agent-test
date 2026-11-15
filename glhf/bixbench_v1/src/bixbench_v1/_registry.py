"""Inspect's entry point for this package: registers the `bixbench_modal` sandbox provider (and
`glhf_modal`, the same sandbox for the research engine's swarm runs, glhf_modal.py) when the
optional `modal` dependency group is installed, and does nothing when it is not."""

from __future__ import annotations

try:
    from .glhf_modal_sandbox import GlhfModalSandbox
    from .modal_sandbox import BixModalSandbox
except ImportError:  # `uv sync` without `--group modal`: only local Docker is available
    BixModalSandbox = None  # type: ignore[assignment,misc]
    GlhfModalSandbox = None  # type: ignore[assignment,misc]

__all__ = ["BixModalSandbox", "GlhfModalSandbox"]
