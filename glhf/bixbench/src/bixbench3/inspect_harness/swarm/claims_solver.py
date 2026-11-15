"""The claims engine inside the solver: the hooks engine.py calls, the Scout and the Finisher as code.

`ClaimHooks` runs one role on one claim as an Inspect agent with its own folder, bash instance,
time limit and token limit (the claim's share, from claim_budget). The tokens a call used are read
from its own token limit, so claims worked on in parallel are counted apart. The checks that move
a claim are the deterministic shape check (tools.check_contract), never the model's words.

`scout_code` replaces the Scout agent: a standard-library script lists the data, checks that each
file opens, and lists the tools that are installed. `assemble_outputs` replaces the Finisher agent:
each required artifact is copied to /outputs from the best claim that produced it (supported first,
then not established, then rejected), and where it came from is logged. Nothing is ever made up:
an artifact that no claim produced stays missing.
"""

from __future__ import annotations

import json
import shlex
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from inspect_ai.agent import AgentState, run
from inspect_ai.model import ChatMessage, ChatMessageUser
from inspect_ai.tool import Tool
from inspect_ai.util import Limit, message_limit, sandbox, time_limit, token_limit

from ..models import ExpectedOutput
from . import roles
from .board import ACUITY_WEIGHT, Board, ClaimRecord, State, open_issues_for
from .claim_budget import SKIP_CALL_SECONDS, call_seconds
from .engine import CallResult, Check, Left
from .flags import SwarmFlags
from .ledger import Ledger
from .tools import (
    WORK,
    check_contract,
    check_failed,
    claim_done,
    contract_text,
    needs_rescue,
    raise_claim_issue,
    record_falsification_test,
    register_falsification_test,
    report_failed_replication,
    resolve_issue,
)

# mode -> (agent name, instructions, model group)
MODES: dict[str, tuple[str, str, str]] = {
    "pilot": ("pilot", roles.PILOT, "experimenter"),
    "workup": ("experimenter", roles.EXPERIMENTER, "experimenter"),
    "revise": ("reviser", roles.REVISER, "experimenter"),
    "audit": ("auditor", roles.AUDITOR, "critic"),
    "critique": ("critic", roles.CRITIC, "critic"),
}
MAKERS = ("pilot", "workup", "revise")  # modes that must end with claim_done

STATE_RANK = {State.SUPPORTED: 0, State.NOT_ESTABLISHED: 1, State.REJECTED: 2}


@dataclass
class ClaimHooks:
    ledger: Ledger
    board: Board
    flags: SwarmFlags
    outputs: list[ExpectedOutput]
    brief: str
    seconds_left: Callable[[], float]  # what the run has left for claims (reserves excluded)
    tokens_used: Callable[[], int]
    max_tokens: int | None
    make_agent: Callable[[str, str, str | None, list[Tool]], Any]  # solver.agent -> Role
    models: dict[str, str | None]  # model group -> model name (None = the eval's model)
    default_model: str
    after: Callable[[int], Awaitable[None]]  # relevance judge, then the harness runs the tests
    messages: list[ChatMessage]  # the sample's transcript, for the process judge
    max_messages: int | None = None
    # Books one finished call in the run's TokenBook: (label, tokens used, token cap or None).
    charge: Callable[[str, int, int | None], None] | None = None
    done: dict[str, tuple[str, str]] = field(default_factory=dict)

    async def call(
        self, role: str, mode: str, record: ClaimRecord, tokens: int | None, attempt: int
    ) -> CallResult:
        del role  # the mode decides the agent
        base = mode.split()[0]
        name, instructions, group = MODES[base]
        model = self.models.get(group) or self.default_model
        seconds = call_seconds(record, mode, self.flags, run_left=self.seconds_left())
        if seconds < SKIP_CALL_SECONDS:
            return CallResult(
                "limit", note=f"{int(seconds)} s left for the run's claims", model=model
            )
        key = f"{record.id}:{mode}:{attempt}"
        extra: list[Tool] = []
        if base in MAKERS:
            extra.append(claim_done(self.done, key))
        if base == "revise":
            extra.append(resolve_issue(self.ledger, "experimenter"))
        if base == "audit":
            extra.append(raise_claim_issue(self.ledger, "auditor", record.id))
        if base == "critique":
            extra += [
                raise_claim_issue(self.ledger, "critic", record.id),
                register_falsification_test(self.ledger, "critic", only_claim=record.id),
                record_falsification_test(self.ledger, "critic", only_claim=record.id),
                report_failed_replication(self.ledger, "critic", only_claim=record.id),
            ]
        who = self.make_agent(f"{name}-{record.id}", instructions, self.models.get(group), extra)
        folder = record.work_dir
        await sandbox().exec(
            ["mkdir", "-p", f"{folder}/scripts", f"{folder}/outputs", f"{folder}/pilot/outputs"]
        )
        issues = "\n".join(
            f"- {i.id} ({i.severity}): {i.problem}" for i in open_issues_for(self.ledger, record)
        )
        tests = "\n".join(
            f"- {r.name}: {r.method}" for r in self.ledger.claims[record.id].registered
        )
        prompt = f"{self.brief}\n\n---\n\n" + roles.claim_task(
            mode, record.id, record.text, folder, issues, tests
        )
        limit_tokens = token_limit(tokens) if tokens else None
        limits: list[Limit] = [time_limit(int(seconds))]
        if limit_tokens is not None:
            limits.append(limit_tokens)
        if self.max_messages:
            limits.append(message_limit(self.max_messages))
        before, began = self.tokens_used(), time.monotonic()

        def call_usage() -> int:
            if limit_tokens is not None:
                try:
                    return int(limit_tokens.usage)
                except Exception:
                    pass  # fall back to the run's counter (exact when calls run one by one)
            return self.tokens_used() - before

        try:
            result = await run(who.agent, prompt, limits=limits)
        except Exception:
            # The engine records the error; the tokens the call spent are still booked.
            if self.charge is not None:
                self.charge(f"claim {key}", call_usage(), tokens)
            raise
        agent_state, limit_error = result if isinstance(result, tuple) else (result, None)
        assert isinstance(agent_state, AgentState)
        # One call's transcript is added in one piece, under a header naming the claim.
        self.messages.append(
            ChatMessageUser(content=f"=== GLHF claim {record.id}: {mode} (attempt {attempt}) ===")
        )
        self.messages.extend(m for m in agent_state.messages if m.role != "system")
        used = call_usage()
        elapsed = time.monotonic() - began
        if self.charge is not None:
            self.charge(f"claim {key}", used, tokens)
        if limit_error is not None:
            kind = str(getattr(limit_error, "type", "limit"))
            return CallResult("limit", used, elapsed, f"stopped by the {kind} limit", model)
        if base in MAKERS:
            if key not in self.done:
                return CallResult("malformed", used, elapsed, "ended without claim_done", model)
            status, note = self.done[key]
            return CallResult(status, used, elapsed, note, model)
        return CallResult("ok", used, elapsed, "", model)

    def _specs(self, record: ClaimRecord) -> list[ExpectedOutput]:
        mine = [o for o in self.outputs if o.artifact_id in record.artifact_ids]
        return mine or list(self.outputs)

    async def _shape(self, record: ClaimRecord, root: str, what: str) -> Check:
        report = await check_contract(self._specs(record), root=root)
        text = contract_text(report)
        if check_failed(report):
            # Nothing is known about the files: the claim is not dropped on a guess.
            return Check(
                True, f"the shape check of the {what} could not run", {"contract": text[:1500]}
            )
        failing = needs_rescue(report)
        if failing:
            names = ", ".join(str(f.get("artifact_id", "?")) for f in failing)
            return Check(False, f"{what} fail the shape check ({names})", {"contract": text[:1500]})
        return Check(True, f"{what} pass the shape check", {"contract": text[:1500]})

    async def pilot_passed(self, record: ClaimRecord) -> Check:
        return await self._shape(record, f"{record.work_dir}/pilot/outputs", "pilot outputs")

    async def artifacts_present(self, record: ClaimRecord) -> Check:
        return await self._shape(record, f"{record.work_dir}/outputs", "artifacts")

    async def after_critique(self, round_no: int) -> None:
        await self.after(round_no)

    def left(self) -> Left:
        tokens = self.max_tokens - self.tokens_used() if self.max_tokens else None
        return Left(tokens, self.seconds_left())


# -- The Scout, as code ----------------------------------------------------------------------------
_SCOUT_SCRIPT = r"""
import gzip, importlib.util, json, os, shutil, sys
files, problems = [], []
for top, _, names in os.walk("/data"):
    for name in sorted(names):
        path = os.path.join(top, name)
        entry = {"path": path, "bytes": os.path.getsize(path)}
        try:
            opener = gzip.open if name.endswith(".gz") else open
            with opener(path, "rb") as handle:
                head = handle.read(65536)
            entry["lines_in_first_64k"] = head.count(b"\n")
            if entry["bytes"] == 0:
                problems.append(f"{path}: empty")
        except Exception as error:
            entry["error"] = f"{type(error).__name__}: {error}"[:200]
            problems.append(f"{path}: cannot be read ({entry['error']})")
        files.append(entry)
tools = {t: bool(shutil.which(t)) for t in ("python3", "Rscript", "samtools", "featureCounts", "STAR", "salmon", "bowtie2", "bwa")}
modules = {m: importlib.util.find_spec(m) is not None for m in ("pandas", "numpy", "scipy", "statsmodels", "scanpy")}
print(json.dumps({"files": files[:500], "file_count": len(files), "problems": problems[:100], "tools": tools, "python_modules": modules}))
"""


async def scout_code() -> dict[str, Any]:
    """Inventory /data and the installed tools; write data_report.md. No model is called."""
    result = await sandbox().exec(["python3", "-c", _SCOUT_SCRIPT], timeout=120)
    if not result.success:
        report: dict[str, Any] = {"error": (result.stderr or "scout script failed")[:500]}
    else:
        report = json.loads(result.stdout or "{}")
    lines = ["# Data report (written by code, no model)", ""]
    if "error" in report:
        lines.append(f"The inventory script failed: {report['error']}")
    else:
        lines.append(f"{report['file_count']} files under /data.")
        lines += ["", "## Problems", *([f"- {p}" for p in report["problems"]] or ["- none found"])]
        lines += [
            "",
            "## Files",
            *(f"- {f['path']} ({f['bytes']} bytes)" for f in report["files"][:200]),
        ]
        lines += [
            "",
            "## Tools",
            *(f"- {t}: {'yes' if ok else 'no'}" for t, ok in report["tools"].items()),
        ]
        lines += [
            *(
                f"- python {m}: {'yes' if ok else 'no'}"
                for m, ok in report["python_modules"].items()
            )
        ]
    await sandbox().write_file(f"{WORK}/data_report.md", "\n".join(lines) + "\n")
    return report


# -- The Finisher, as code -------------------------------------------------------------------------
async def assemble_outputs(board: Board, outputs: list[ExpectedOutput]) -> list[dict[str, Any]]:
    """Copy each required artifact to /outputs from the best claim that has it. Returns one entry per
    artifact: where it came from, or that no claim produced it."""
    order = sorted(
        board.claims.values(),
        key=lambda c: (STATE_RANK.get(c.state, 3), -ACUITY_WEIGHT[c.acuity], c.id),
    )
    placed: list[dict[str, Any]] = []
    for output in outputs:
        relative = output.sandbox_path.removeprefix("/outputs/")
        source, named = None, False
        # First the claims that name the artifact, then any other claim that wrote it: a workup
        # often writes more files than its claim names, and a missing file scores zero.
        for wanted in (True, False):
            for record in order:
                if (
                    record.state == State.REJECTED
                    and record.history
                    and record.history[-1].from_state == State.PILOTING
                ):
                    continue  # dead on arrival: it only has subsampled pilot files
                names_it = not record.artifact_ids or output.artifact_id in record.artifact_ids
                if names_it != wanted:
                    continue
                candidate = f"{record.work_dir}/outputs/{relative}"
                target_dir = shlex.quote(_parent(output.sandbox_path))
                copied = await sandbox().exec(
                    [
                        "sh",
                        "-c",
                        f"test -s {shlex.quote(candidate)} && mkdir -p {target_dir}"
                        f" && cp {shlex.quote(candidate)} {shlex.quote(output.sandbox_path)}",
                    ],
                    timeout=60,
                )
                if copied.success:
                    source, named = record, names_it
                    break
            if source is not None:
                break
        entry: dict[str, object] = {"artifact": output.artifact_id, "path": output.sandbox_path}
        if source is None:
            entry |= {"from": None, "note": "no claim produced it; left missing, never made up"}
        else:
            entry |= {"from": source.id, "claim_state": str(source.state), "named_by_claim": named}
        placed.append(entry)
    board.event("finish.assembled", artifacts=placed)
    return placed


def _parent(path: str) -> str:
    return path.rsplit("/", 1)[0] or "/"
