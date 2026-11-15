"""What runner.py does differently for `--sandbox modal`: three steps around the same run.

  prepare   refuse if paid calls are off or the folder's Modal cap would be passed; put the
            capsule's staged data on the Volume (once); build the sandbox config; register
            where the outputs and the ledger lines go.
  (Inspect runs the solver; modal_sandbox.py creates, probes and terminates the sandboxes.)
  finish    the last net: terminate any sandbox of this run that is still alive.
  settings  what run.json records about the Modal side.

Only `prepare` imports Modal, and only when it is called.
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import modal_boundary, modal_cost, modal_stage, paid, staging
from .modal_boundary import BixModalConfig
from .modal_image import APP_NAME, OFFICIAL_IMAGE, PUBLISHED

IMAGE_NOTE = (
    f"{PUBLISHED}: our amd64 rebuild of {OFFICIAL_IMAGE} (arm64 only). Not the official "
    "image: see glhf/bixbench_v1/image/DIFF.md. Not comparable with published BixBench "
    "numbers or with a local Docker run."
)


@dataclass
class ModalRun:
    config: BixModalConfig
    staged: modal_stage.StagedData
    uploaded: bool
    upload_seconds: float
    started: float
    sandboxes_planned: int
    worst_case_usd: float

    def task_args(self) -> dict[str, Any]:
        return {"modal_config": self.config.model_dump()}

    def finish(self) -> list[str]:
        from . import modal_sandbox

        return modal_sandbox.terminate_run(self.config.run_tag, self.config, self.started)

    def settings(self, leftover: list[str] | None = None) -> dict[str, Any]:
        from . import modal_sandbox

        measured = modal_sandbox.summary(self.config.run_tag)
        probes = measured.pop("probes", [])
        return {
            "app": self.config.app,
            "run_tag": self.config.run_tag,  # the tag on this run's sandboxes; random
            "image": self.config.image,
            "image_note": IMAGE_NOTE,
            "volume": self.config.volume,
            "data_key": self.staged.key,
            "data_uploaded_this_run": self.uploaded,
            "data_upload_seconds": round(self.upload_seconds, 1),
            "cpu": self.config.cpu,
            "memory_mib": self.config.memory_mib,
            "timeout_seconds": self.config.timeout_seconds,
            "block_network": True,
            "critic_isolation": "a separate, new sandbox" if self.sandboxes_planned > 1 else None,
            "price_per_second_usd": modal_cost.sandbox_rate(
                self.config.cpu, self.config.memory_mib
            ),
            "prices_read": modal_cost.PRICES_READ,
            "worst_case_usd": round(self.worst_case_usd, 4),
            **measured,
            # Every sandbox of the run was probed before use; a failed probe stops the run.
            "network_probe": "passed"
            if probes and not any(p.get("reached") for p in probes)
            else "not run",
            "data_probe": "passed" if probes else "not run",
            "machines": sorted({f"{p.get('machine')} {p.get('kernel')}" for p in probes}),
            "left_over_terminated": leftover or [],
        }


def prepare(
    *,
    data_dir: Path,
    manifest: staging.Manifest,
    outputs_dir: Path,
    run_dir: Path,
    run_name: str,
    capsule: str,
    solver: str,
    time_limit_seconds: int,
    backstop_seconds: int,
    image: str | None = None,
    cpu: float = 4.0,
    memory_mib: int = 16384,
    ledgers: list[Path] | None = None,
    usd_cap: float | None = None,
    volume: Any = None,
) -> ModalRun:
    """`data_dir` and `manifest` are the staged capsule, already verified and leak-scanned by
    the caller. `volume` replaces the real Modal Volume in tests."""
    paid.refuse_modal(f"--sandbox modal for {capsule}")  # NO_PAID_CALLS, also for direct callers
    sandboxes = 2 if solver == "glhf" else 1
    timeout = modal_boundary.sandbox_timeout(time_limit_seconds, backstop_seconds)
    worst = modal_cost.worst_case_usd(timeout, cpu, memory_mib, sandboxes)
    files = [run_dir / modal_cost.LEDGER_NAME, *(ledgers or [])]
    unique = list({path.resolve(): path for path in files}.values())
    # The cap is read from the first shared ledger (the --out folder's), else this run's own.
    modal_cost.check_cap(unique[1] if len(unique) > 1 else unique[0], usd_cap, worst)
    if volume is None:
        import modal

        volume = modal.Volume.from_name(modal_stage.VOLUME_NAME, create_if_missing=True)
    began = time.time()
    staged, uploaded = modal_stage.ensure_uploaded(volume, data_dir, manifest)
    upload_seconds = time.time() - began
    config = BixModalConfig(
        run_tag=secrets.token_hex(16),
        image=image or PUBLISHED,
        app=APP_NAME,
        volume=modal_stage.VOLUME_NAME,
        data_path=staged.data_path,
        files=staged.files,
        listing_sha256=staged.listing_sha256,
        content_sha256=staged.content_sha256,
        timeout_seconds=timeout,
        cpu=cpu,
        memory_mib=memory_mib,
    )
    from . import modal_sandbox

    modal_sandbox.register_run(
        config.run_tag,
        modal_sandbox.RunContext(
            outputs_dir=outputs_dir, ledgers=unique, run=run_name, capsule=capsule, solver=solver
        ),
    )
    return ModalRun(config, staged, uploaded, upload_seconds, time.time(), sandboxes, worst)
