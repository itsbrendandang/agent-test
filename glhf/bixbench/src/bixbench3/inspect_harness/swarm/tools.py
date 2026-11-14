"""Tools the swarm roles share. The ledger tools are bound to one role so every entry is attributed."""

from __future__ import annotations

import json
import os
import re
from typing import Any, Literal

import httpx
from inspect_ai.tool import Tool, ToolError, tool
from inspect_ai.util import sandbox

from ...network_gateway.policy import (
    RESTRICTED_DOMAIN_SCOPES,
    domain_matches,
    host_from_url,
    normalize_url,
)
from ..models import ExpectedOutput, NetworkAccessPolicy
from .ledger import Ledger

WORK = "/workspace/work/glhf"

# Runs inside the sandbox with only the standard library. Checks shape, not correctness.
# "problems" mean the grader is likely to score the artifact zero or wrongly as it stands;
# "fatal" marks the ones the finisher is for (missing, empty, unparseable, no row-key column);
# "warnings" are legitimate in some tasks (one column, no rows, empty JSON) and need a human look.
_CONTRACT_SCRIPT = r"""
import csv, json, os, sys
specs = json.loads(sys.argv[1])
csv.field_size_limit(1 << 30)
TABLE_FORMATS = ("csv", "tsv", "txt", "tab", "table", "tabular")
report = []
for s in specs:
    path, fmt, key = s["sandbox_path"], (s.get("format") or "").lower(), s.get("row_key")
    r = {"artifact_id": s["artifact_id"], "path": path, "problems": [], "warnings": [], "fatal": False}
    report.append(r)
    if not os.path.exists(path):
        r["problems"].append("missing"); r["fatal"] = True; continue
    size = os.path.getsize(path); r["bytes"] = size
    if size == 0:
        r["problems"].append("empty file"); r["fatal"] = True; continue
    ext = os.path.splitext(path)[1].lower()
    try:
        if fmt == "json" or (ext == ".json" and fmt not in TABLE_FORMATS):
            with open(path) as fh: data = json.load(fh)
            r["json_type"] = type(data).__name__
            if not data: r["warnings"].append("empty JSON (fine only if the result really is empty)")
        elif fmt in TABLE_FORMATS or ext in (".csv", ".tsv", ".txt", ".tab"):
            with open(path, newline="") as fh:
                first = fh.readline()
            tabs, commas = first.count("\t"), first.count(",")
            if fmt == "tsv" or ext in (".tsv", ".tab"): expected = "\t"
            elif fmt == "csv" or ext == ".csv": expected = ","
            else: expected = None
            # No declared delimiter (.txt, "table"): take the one the header line uses.
            delim = expected or ("\t" if tabs >= commas and tabs else ",")
            name = {"\t": "tab", ",": "comma"}
            r["delimiter"] = name[delim]
            with open(path, newline="") as fh:
                rows = csv.reader(fh, delimiter=delim)
                header = next(rows, [])
                body = [row for _, row in zip(range(200000), rows)]
            r["columns"] = header[:40]; r["rows_checked"] = len(body)
            other = "," if delim == "\t" else "\t"
            if len(header) <= 1 and first.count(other):
                r["problems"].append(f"wrong delimiter: expected {name[delim]}-separated, the header line uses {name[other]}s")
                r["fatal"] = True
            elif len(header) <= 1:
                r["warnings"].append("single column (fine only if the brief asks for one column)")
            if not body:
                r["warnings"].append("header only, no rows (fine only if the result really is empty)")
            if key:
                if key not in header:
                    r["problems"].append(f"row_key column {key!r} not in header"); r["fatal"] = True
                else:
                    i = header.index(key); keys = [row[i] for row in body if len(row) > i]
                    if len(set(keys)) != len(keys): r["problems"].append(f"duplicate {key!r} values")
                    if any(k.strip() == "" for k in keys): r["problems"].append(f"blank {key!r} values")
            ragged = sum(1 for row in body if len(row) != len(header))
            if ragged: r["problems"].append(f"{ragged} rows with a different column count than the header")
            cells = [c.strip().lower() for row in body[:5000] for c in row]
            na = sum(c in ("", "na", "nan", "none", "null") for c in cells)
            if cells and na / len(cells) > 0.5: r["warnings"].append(f"{na}/{len(cells)} sampled cells are empty/NA")
    except Exception as e:
        r["problems"].append(f"could not parse: {e}"); r["fatal"] = True
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
    warned = [r for r in report if r.get("warnings")]
    lines = [f"{len(ok)}/{len(report)} required artifacts pass the shape check."]
    lines += [
        f"- {r['artifact_id']} ({r.get('path')}): {'; '.join(map(str, r['problems']))}" for r in bad
    ]
    if warned:
        lines.append(
            "Warnings (not failures; check each against the brief before changing anything):"
        )
        lines += [
            f"- {r['artifact_id']} ({r.get('path')}): {'; '.join(map(str, r['warnings']))}"
            for r in warned
        ]
    return "\n".join(lines)


def needs_rescue(report: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Artifacts the finisher is for: missing, empty, unparseable or without the row-key column."""
    return [r for r in report if r.get("fatal") or r.get("artifact_id") == "*"]


# Runs inside the sandbox. Lists (and with "kill", stops) processes that are not the container's
# own (pid 1, `sleep infinity`), not Inspect's tool server and not a role's idle session shell:
# what is left are jobs a role started in the background.
_PROCESS_SCRIPT = r"""
import json, os, signal, sys, time
def parent(pid):
    try:
        with open(f"/proc/{pid}/stat") as fh: return int(fh.read().rsplit(")", 1)[1].split()[1])
    except Exception: return 0
keep, p = set(), os.getpid()
while p > 1: keep.add(p); p = parent(p)
found = []
for name in os.listdir("/proc"):
    if not name.isdigit(): continue
    pid = int(name)
    if pid == 1 or pid in keep: continue
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as fh: cmd = fh.read().replace(b"\0", b" ").decode(errors="replace").strip()
    except Exception: continue
    if not cmd or "inspect-sandbox-tools" in cmd or "docker-init" in cmd: continue
    if cmd in ("sleep infinity", "/bin/bash -i", "bash -i", "/bin/sh -i", "sh -i"): continue
    found.append({"pid": pid, "cmd": cmd[:200]})
if sys.argv[1] == "kill" and found:
    for sig in (signal.SIGTERM, signal.SIGKILL):
        for f in found:
            try: os.kill(f["pid"], sig)
            except Exception: pass
        time.sleep(2)
print(json.dumps(found))
"""


async def background_processes(kill: bool = False) -> list[dict[str, Any]]:
    """Jobs roles left running in the sandbox; `kill=True` stops them (TERM, then KILL)."""
    result = await sandbox().exec(
        ["python3", "-c", _PROCESS_SCRIPT, "kill" if kill else "list"], timeout=60
    )
    if not result.success:
        return []
    found: list[dict[str, Any]] = json.loads(result.stdout or "[]")
    return found


async def save_ledger(ledger: Ledger) -> None:
    await sandbox().exec(["mkdir", "-p", WORK])
    await sandbox().write_file(f"{WORK}/ledger.json", ledger.to_json())


@tool
def check_outputs(outputs: list[ExpectedOutput]) -> Tool:
    async def execute() -> str:
        """Deterministically check every required output file: present, non-empty, parseable,
        row_key column present and unique, delimiter and column counts consistent.
        This checks shape only, not scientific correctness. Lines under "Warnings" (one column,
        no rows, empty JSON, mostly NA) are not failures: compare them with the brief.
        Run it before declaring any artifact done."""
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
        the result goes against the claim. The verdict is computed by code (e-values, alpha=0.1 shared
        across all claims). Every recorded test counts, a test name is accepted once per claim, and
        a claim takes at most 3 tests, so decide the tests before you run them. Tests on one claim
        must be independent of each other: different data splits or different methods, never the
        same test rerun or renamed.

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


# --- Optional documentation search (Exa). Off unless the run sets exa=True. -----------------------
# The benchmark asks agents to reproduce a published analysis, so an open web search could surface
# the paper's own results. This tool therefore searches an allow-list of software documentation
# and community help sites only: no journals, preprint servers, code hosts or data repositories.
# The allow-list is enforced twice: Exa is asked for these domains only, and every returned URL is
# checked here again, against the list and against the case's own network policy.
DOC_DOMAINS = [
    "bioconductor.org",
    "support.bioconductor.org",
    "biostars.org",
    "readthedocs.io",
    "rdrr.io",
    "cran.r-project.org",
    "r-project.org",
    "pypi.org",
    "python.org",
    "htslib.org",
    "support.10xgenomics.com",
    "nf-co.re",
    "training.galaxyproject.org",
    "hbctraining.github.io",
    "stackoverflow.com",
    "bioinformatics.stackexchange.com",
    "stats.stackexchange.com",
    "satijalab.org",
]
MAX_SEARCHES = 20  # per run, all roles together
# Identifiers of a study or its data. A query that carries one is looking for the study.
_STUDY_ID = re.compile(
    r"\b10\.\d{4,9}/\S+"  # DOI
    r"|\b(?:GSE|GSM|GDS|GPL)\d{3,}\b"  # GEO
    r"|\b[SED]R[RXPSA]\d{4,}\b"  # SRA / ENA / DDBJ runs, experiments, projects, samples
    r"|\bPRJ(?:NA|EB|DB)\d+\b|\bSAM(?:N|EA|D)\d+\b"  # BioProject, BioSample
    r"|\bE-[A-Z]{4}-\d+\b"  # ArrayExpress
    r"|\bPMC\d{4,}\b|\bPMID:?\s*\d{5,}\b|\bpubmed\s*\d{5,}\b"
    r"|\b(?:phs|EGA[SDCN])\d{6,}\b"  # dbGaP, EGA
    r"|\b(?:doi\.org|zenodo|figshare|biorxiv|medrxiv)\b",
    re.IGNORECASE,
)
# Verbatim from Exa's build-with-exa skill: the description of the `objective` parameter.
_OBJECTIVE = (
    "Goal for this search turn; say which documents should rank first, which should be excluded, "
    "and what specific facts or figures to pull from them."
)


def query_refusal(text: str, doi: str | None = None) -> str | None:
    """Why a search text is refused, or None. Checked on the query and on the objective."""
    found = _STUDY_ID.search(text)
    if found:
        return f"it contains a study or dataset identifier ({found.group(0)[:40]!r})"
    if doi and doi.lower() in text.lower():
        return "it contains the study's DOI"
    return None


def result_block_reason(url: str, policy: NetworkAccessPolicy | None = None) -> str | None:
    """Why a returned URL is dropped, or None. The case's policy wins over the allow-list."""
    try:
        normalized = normalize_url(url)
        host = host_from_url(url)
    except ValueError:
        return "not an http(s) URL"
    if not any(domain_matches(host, d) for d in DOC_DOMAINS):
        return "host is not on the documentation allow-list"
    restricted = [*RESTRICTED_DOMAIN_SCOPES, *(policy.restricted_domain_scopes if policy else [])]
    if any(domain_matches(host, d) for d in restricted):
        return "host is a restricted code or data host"
    if policy:
        if any(domain_matches(host, d) for d in policy.answer_source_domains):
            return "host is an answer source for this task"
        for source in policy.answer_source_urls:
            try:
                if normalized.startswith(normalize_url(source).rstrip("/")):
                    return "URL is an answer source for this task"
            except ValueError:
                continue
    return None


async def exa_docs(query: str, objective: str, api_key: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            "https://api.exa.ai/search",
            headers={"x-api-key": api_key},
            json={
                "query": query,
                "objective": objective,
                "type": "auto",
                "includeDomains": DOC_DOMAINS,
                "contents": {"highlights": True},
            },
        )
    if response.status_code >= 400:
        raise ToolError(f"search failed ({response.status_code}): {response.text[:300]}")
    body: dict[str, Any] = response.json()
    return body


@tool
def search_docs(
    ledger: Ledger, role: str, policy: NetworkAccessPolicy | None = None, doi: str | None = None
) -> Tool:
    async def execute(query: str, objective: str) -> str:
        """Search software documentation and bioinformatics help sites (not papers, not data).

        Use it for tool usage, parameters, file formats, error messages and version differences.
        It cannot and must not be used to look up the study being reproduced or its results:
        a query with a DOI, an accession or a paper identifier is refused, and the run has a
        fixed number of searches.

        Args:
            query: What to retrieve, as plain natural-language intent, e.g. "featureCounts
                reverse-stranded paired-end -s 2 -p option".
            objective: OBJECTIVE_PLACEHOLDER
        """
        key = os.environ.get("EXA_API_KEY")
        if not key:
            raise ToolError("search is not available: EXA_API_KEY is not set on the runner")

        async def refuse(reason: str) -> ToolError:
            ledger.log("search.refused", by=role, query=query[:300], reason=reason)
            await save_ledger(ledger)
            return ToolError(f"search refused: {reason}")

        used = sum(1 for e in ledger.events if e.get("kind") == "search")
        if used >= MAX_SEARCHES:
            raise await refuse(f"the run's limit of {MAX_SEARCHES} searches is used up")
        reason = query_refusal(f"{query}\n{objective}", doi)
        if reason:
            raise await refuse(reason + "; search_docs is for software documentation only")
        body = await exa_docs(query, objective, key)
        results, dropped = [], []
        for r in body.get("results", []):
            why = result_block_reason(str(r.get("url") or ""), policy)
            if why:
                dropped.append({"url": r.get("url"), "reason": why})
            else:
                results.append(r)
        ledger.log(
            "search", by=role, query=query, urls=[r.get("url") for r in results], dropped=dropped
        )
        await save_ledger(ledger)
        if not results:
            return "Nothing relevant found on the documentation sites."
        lines = [
            f"- {r.get('title') or r.get('url')}\n  {r.get('url')}\n  "
            + " ".join(" ".join(r.get("highlights") or []).split())[:700]
            for r in results[:8]
        ]
        notices = [f"Note from the search engine: {n['message']}" for n in body.get("notices", [])]
        return "\n".join(lines + notices)

    assert execute.__doc__
    execute.__doc__ = execute.__doc__.replace("OBJECTIVE_PLACEHOLDER", _OBJECTIVE)
    return execute
