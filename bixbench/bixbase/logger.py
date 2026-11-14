"""Run logging: JSONL transcript + reproducible final script.

Every run writes <run_dir>/transcript.jsonl with one event per line:
  run_start, message, tool_call, tool_result, usage, final_answer, budget, run_end
All code cells also accumulate into <run_dir>/final_script.py so the analysis
is reproducible outside the agent loop.

Never log secrets: this module only records payloads it is explicitly given;
env vars and client internals are never serialized.
"""

from __future__ import annotations

import json
import platform
import subprocess
import time
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

_TRACKED_PKGS = [
    "anthropic", "openai", "pandas", "numpy", "scipy",
    "statsmodels", "matplotlib", "datasets", "bixbase",
]


class RunLogger:
    def __init__(self, run_dir: Path):
        self.run_dir = Path(run_dir)
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self._fh = open(  # noqa: SIM115 - closed in close()
            self.run_dir / "transcript.jsonl", "w", buffering=1
        )
        self._script = self.run_dir / "final_script.py"
        self._script.unlink(missing_ok=True)
        self._cell = 0

    def log(self, event: str, **payload: Any) -> None:
        self._fh.write(
            json.dumps({"t": round(time.time(), 3), "event": event, **payload})
            + "\n"
        )

    # -- convenience wrappers ------------------------------------------------

    def log_run_start(self, **meta: Any) -> None:
        self.log("run_start", env=self._env_meta(), **meta)

    def log_message(self, role: str, content: Any) -> None:
        self.log("message", role=role, content=content)

    def log_tool_call(self, name: str, call_id: str, tool_input: dict) -> None:
        self.log("tool_call", name=name, id=call_id, input=tool_input)

    def log_tool_result(self, call_id: str, name: str, result: str) -> None:
        self.log("tool_result", id=call_id, name=name, result=result)

    def log_code_cell(self, code: str, result: Any) -> None:
        """Append a run_code cell to the reproducible script."""
        with open(self._script, "a") as f:
            f.write(f"\n# %% cell {self._cell}\n{code}\n")
        self._cell += 1

    def log_final_answer(self, answers: dict, forced: bool, reason: str) -> None:
        self.log("final_answer", answers=answers, forced=forced, reason=reason)

    def log_budget(self, snapshot: dict) -> None:
        self.log("budget", **snapshot)

    def log_run_end(self, **summary: Any) -> None:
        self.log("run_end", **summary)

    def close(self) -> None:
        self._fh.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    # -- provenance -----------------------------------------------------------

    @staticmethod
    def _env_meta() -> dict:
        pkgs = {}
        for p in _TRACKED_PKGS:
            try:
                pkgs[p] = version(p)
            except PackageNotFoundError:
                pass
        try:
            git = subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"],
                capture_output=True, text=True, timeout=5,
            )
            git_sha = git.stdout.strip() or None
        except Exception:  # noqa: BLE001
            git_sha = None
        return {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "packages": pkgs,
            "git_sha": git_sha,
        }
