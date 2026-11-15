"""`glhf_modal`: the Modal sandbox of the research engine's swarm runs (see glhf_modal.py).

PR #32's provider, `BixModalSandbox`, unchanged in everything that guards the boundary: the same
plan, `check_create_kwargs`, probe, environment check, copy-out and termination, and the same
ledger lines. Three differences, because the BixBench3 swarm expects the layout of its local
Docker sandbox (glhf/bixbench/sandbox/local-compose.yaml):

  - /workspace exists, as root's, before the solver starts (the harness links /workspace/data
    and /workspace/outputs into it and keeps its working files under /workspace/work);
  - commands start in /workspace when no other folder is given, as `working_dir: /workspace`
    does in the compose file;
  - `analysis_backend()` says where the commands run ({"backend": "modal", "sandbox_id": ...,
    "image": ...}); the harness records it with every registered test it runs.

Needs the optional `modal` group, like modal_sandbox.py.
"""

from __future__ import annotations

from typing import Any, override

import modal
from inspect_ai.util import ExecResult, sandboxenv

from . import staging
from .modal_boundary import BixModalConfig
from .modal_sandbox import BixModalSandbox, _raw_exec

PROVIDER = "glhf_modal"
WORKSPACE = "/workspace"
MAKE_WORKSPACE = f"set -e; mkdir -p {WORKSPACE}; chown root:root {WORKSPACE}"


@sandboxenv(name=PROVIDER)
class GlhfModalSandbox(BixModalSandbox):
    """One swarm run's sandbox on Modal. See the module text for what differs from #32's.
    `sample_init`, cleanup and the run-level net are #32's: they create through `cls._start`."""

    def __init__(self, sandbox: modal.Sandbox, config: BixModalConfig, started: float) -> None:
        super().__init__(sandbox, config, started)
        self._working_dir = WORKSPACE  # relative file paths resolve here, as in the compose file

    @override
    @classmethod
    async def _start(cls, config: BixModalConfig) -> tuple[modal.Sandbox, float, dict[str, Any]]:
        """#32's start (plan, data, probe, environment check), then /workspace. A sandbox where
        that fails is terminated with its ledger line, like one that fails the probe."""
        sandbox, started, result = await super()._start(config)
        try:
            made = await _raw_exec(sandbox, ["bash", "-c", MAKE_WORKSPACE], timeout=120)
            if made[0] != 0:
                raise staging.IntegrityError(f"making {WORKSPACE} failed: {made[2][-300:]}")
        except BaseException:
            cls._finish(sandbox, config, started, "refused at start", ok=False)
            raise
        return sandbox, started, result

    @override
    async def exec(
        self,
        cmd: list[str],
        input: str | bytes | None = None,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        user: str | None = None,
        timeout: int | None = None,
        timeout_retry: bool = True,
        concurrency: bool = True,
    ) -> ExecResult[str]:
        return await super().exec(
            cmd,
            input=input,
            cwd=cwd or WORKSPACE,
            env=env,
            user=user,
            timeout=timeout,
            timeout_retry=timeout_retry,
            concurrency=concurrency,
        )

    def analysis_backend(self) -> dict[str, str]:
        """Where this run's commands execute, for the ledger (swarm/tools.py sandbox_backend)."""
        return {
            "backend": "modal",
            "sandbox_id": str(getattr(self.sandbox, "object_id", "") or ""),
            "image": self.bix.image,
        }


__all__ = ["PROVIDER", "WORKSPACE", "GlhfModalSandbox"]
