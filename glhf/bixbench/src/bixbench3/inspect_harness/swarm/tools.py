"""Tools the swarm roles share. The ledger tools are bound to one role so every entry is attributed."""

from __future__ import annotations

import json
from typing import Any, Literal

from inspect_ai.tool import Tool, ToolError, tool
from inspect_ai.util import sandbox

from ..models import ExpectedOutput
from .ledger import Ledger

WORK = "/workspace/work/glhf"

# Runs inside the sandbox with only the standard library. Checks shape, not correctness.
_CONTRACT_SCRIPT = r"""
import csv, json, os, sys
specs = json.loads(sys.argv[1])
csv.field_size_limit(1 << 30)
report = []
for s in specs:
    path, fmt, key = s["sandbox_path"], (s.get("format") or "").lower(), s.get("row_key")
    r = {"artifact_id": s["artifact_id"], "path": path, "problems": []}
    if not os.path.exists(path):
        r["problems"].append("missing"); report.append(r); continue
    size = os.path.getsize(path); r["bytes"] = size
    if size == 0:
        r["problems"].append("empty file"); report.append(r); continue
    ext = os.path.splitext(path)[1].lower()
    try:
        if fmt in ("csv", "tsv") or ext in (".csv", ".tsv", ".txt"):
            delim = "\t" if (fmt == "tsv" or ext == ".tsv") else ","
            with open(path, newline="") as fh:
                rows = csv.reader(fh, delimiter=delim)
                header = next(rows, [])
                body = [row for _, row in zip(range(200000), rows)]
            r["columns"] = header[:40]; r["rows_checked"] = len(body)
            if len(header) <= 1 and body and len(body[0]) <= 1:
                r["problems"].append(f"single column: wrong delimiter? (expected {'TSV' if delim == chr(9) else 'CSV'})")
            if not body:
                r["problems"].append("header only, no rows")
            if key:
                if key not in header:
                    r["problems"].append(f"row_key column {key!r} not in header")
                else:
                    i = header.index(key); keys = [row[i] for row in body if len(row) > i]
                    if len(set(keys)) != len(keys): r["problems"].append(f"duplicate {key!r} values")
                    if any(k.strip() == "" for k in keys): r["problems"].append(f"blank {key!r} values")
            ragged = sum(1 for row in body if len(row) != len(header))
            if ragged: r["problems"].append(f"{ragged} rows with a different column count than the header")
            cells = [c.strip().lower() for row in body[:5000] for c in row]
            na = sum(c in ("", "na", "nan", "none", "null") for c in cells)
            if cells and na / len(cells) > 0.5: r["problems"].append(f"{na}/{len(cells)} sampled cells are empty/NA")
        elif fmt == "json" or ext == ".json":
            with open(path) as fh: data = json.load(fh)
            r["json_type"] = type(data).__name__
            if not data: r["problems"].append("empty JSON")
    except Exception as e:
        r["problems"].append(f"could not parse: {e}")
    report.append(r)
print(json.dumps(report))
"""


async def check_contract(
    outputs: list[ExpectedOutput], root: str | None = None
) -> list[dict[str, Any]]:
    """Shape-check the required artifacts. `root` checks a copy of the tree, e.g. the pilot's."""
    specs = [{**o.model_dump(), "sandbox_path": o.sandbox_path} for o in outputs]
    if root:
        for spec in specs:
            spec["sandbox_path"] = root.rstrip("/") + spec["sandbox_path"].removeprefix("/outputs")
    result = await sandbox().exec(
        ["python3", "-c", _CONTRACT_SCRIPT, json.dumps(specs)], timeout=600
    )
    if not result.success:
        return [
            {
                "artifact_id": "*",
                "problems": [f"contract check failed to run: {result.stderr[-500:]}"],
            }
        ]
    report: list[dict[str, Any]] = json.loads(result.stdout)
    return report


def contract_text(report: list[dict[str, Any]]) -> str:
    ok = [r for r in report if not r.get("problems")]
    bad = [r for r in report if r.get("problems")]
    lines = [f"{len(ok)}/{len(report)} required artifacts pass the shape check."]
    lines += [
        f"- {r['artifact_id']} ({r.get('path')}): {'; '.join(map(str, r['problems']))}" for r in bad
    ]
    return "\n".join(lines)


async def save_ledger(ledger: Ledger) -> None:
    await sandbox().exec(["mkdir", "-p", WORK])
    await sandbox().write_file(f"{WORK}/ledger.json", ledger.to_json())


@tool
def check_outputs(outputs: list[ExpectedOutput]) -> Tool:
    async def execute() -> str:
        """Deterministically check every required output file: present, non-empty, parseable,
        row_key column present and unique, delimiter and column counts consistent.
        This checks shape only, not scientific correctness. Run it before declaring any artifact done."""
        return contract_text(await check_contract(outputs))

    return execute


@tool
def propose_claim(ledger: Ledger, role: str) -> Tool:
    async def execute(text: str, artifact_ids: list[str], null_hypothesis: str) -> str:
        """Register a falsifiable claim the analysis is expected to support (e.g. "In T98G, compound
        C10 down-regulates REST target genes"). Only claims that survive the critic's falsification
        tests are reported as findings.

        Args:
            text: The claim, one sentence, specific and testable.
            artifact_ids: Required artifacts the claim depends on.
            null_hypothesis: What would be true if the claim were false.
        """
        claim = ledger.add_claim(text, artifact_ids, null_hypothesis, role)
        await save_ledger(ledger)
        return f"Registered {claim.id}."

    return execute


@tool
def record_falsification_test(ledger: Ledger, role: str) -> Tool:
    async def execute(
        claim_id: str, test_name: str, p_value: float, contradicts: bool, note: str
    ) -> str:
        """Record the result of a falsification test you actually ran in the sandbox.

        Design each test so that, if the claim were false, the observed result would be unlikely
        only by chance (permutation of sample labels, held-out replicate, negative-control gene set,
        alternative method on the same data, direction check against a known marker). Report the
        p-value of the observed result under the claim's null hypothesis. Set contradicts=true when
        the result goes against the claim. The verdict is computed by code (e-values, alpha=0.1).

        Args:
            claim_id: Claim id, e.g. "C3".
            test_name: Short name of the test.
            p_value: p-value under the null, from code you ran. Never estimate it.
            contradicts: True if the observed effect goes against the claim.
            note: What you ran (script path) and what you observed.
        """
        if claim_id not in ledger.claims:
            raise ToolError(f"unknown claim {claim_id}; known: {', '.join(ledger.claims)}")
        try:
            claim = ledger.record_test(claim_id, test_name, p_value, contradicts, note, role)
        except ValueError as e:
            raise ToolError(str(e)) from e
        await save_ledger(ledger)
        return f"{claim.id}: verdict {claim.verdict}, combined e-value {claim.e_value:.3g}."

    return execute


@tool
def report_failed_replication(ledger: Ledger, role: str) -> Tool:
    async def execute(claim_id: str, note: str) -> str:
        """Mark a claim refuted because an independent re-implementation did not reproduce it.

        Args:
            claim_id: Claim id.
            note: What was re-implemented, and the discrepancy (numbers).
        """
        if claim_id not in ledger.claims:
            raise ToolError(f"unknown claim {claim_id}")
        ledger.fail_replication(claim_id, note, role)
        await save_ledger(ledger)
        return f"{claim_id} refuted."

    return execute


@tool
def raise_issue(ledger: Ledger, role: str) -> Tool:
    async def execute(
        severity: Literal["blocking", "major", "minor"],
        artifact_ids: list[str],
        problem: str,
        evidence: str,
    ) -> str:
        """Raise a problem with the analysis that must be fixed or explicitly justified before reporting.
        blocking = artifact is missing, malformed, or computed from the wrong samples/contrast;
        major = method deviates from the guidance or a QC check fails; minor = documentation gaps.

        Args:
            severity: blocking, major or minor.
            artifact_ids: Affected required artifacts.
            problem: What is wrong, one or two sentences.
            evidence: The command you ran and the output that shows it.
        """
        issue = ledger.raise_issue(severity, artifact_ids, problem, evidence, role)
        await save_ledger(ledger)
        return f"Raised {issue.id}."

    return execute


@tool
def resolve_issue(ledger: Ledger, role: str) -> Tool:
    async def execute(issue_id: str, status: Literal["fixed", "wontfix"], resolution: str) -> str:
        """Close a critic issue after fixing it (and re-checking), or justify not fixing it.

        Args:
            issue_id: Issue id, e.g. "I2".
            status: fixed or wontfix.
            resolution: What changed (script, rerun) and the evidence it is fixed, or the justification.
        """
        if issue_id not in ledger.issues:
            raise ToolError(f"unknown issue {issue_id}")
        ledger.resolve_issue(issue_id, status, resolution, role)
        await save_ledger(ledger)
        return f"{issue_id} {status}."

    return execute


@tool
def read_ledger(ledger: Ledger) -> Tool:
    async def execute() -> str:
        """Read the shared ledger: claims with test results and verdicts, and critic issues."""
        return ledger.summary()

    return execute
