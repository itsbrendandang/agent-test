"""Inspect's entry point for this package: registers the `bixbench_modal` sandbox provider when
the optional `modal` dependency group is installed, and does nothing when it is not."""

from __future__ import annotations

try:
    from .modal_sandbox import BixModalSandbox
except ImportError:  # `uv sync` without `--group modal`: only local Docker is available
    BixModalSandbox = None  # type: ignore[assignment,misc]

__all__ = ["BixModalSandbox"]
