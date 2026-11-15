"""Tools the swarm roles share. The ledger tools are bound to one role so every entry is attributed."""

from __future__ import annotations

import hashlib
import json
import os
import posixpath
import re
import tempfile
import time
from collections.abc import Sequence
from pathlib import Path, PurePosixPath
from typing import Any, Literal
from urllib.parse import unquote, urlsplit

import anyio
import httpx
from inspect_ai.tool import Tool, ToolError, tool
from inspect_ai.util import sandbox, store

from ... import paid
from ...network_gateway.policy import (
    RESTRICTED_DOMAIN_SCOPES,
    domain_matches,
    host_from_url,
    normalize_url,
)
from ..models import ExpectedOutput, NetworkAccessPolicy
from .guards import names_doi, names_person, normalise, shared_phrase, study_identifier
from .ledger import (
    OUTPUT_TAIL_CHARS,
    RESULT_LINE,
    Ledger,
    Registration,
    Run,
    parse_result_line,
)

WORK = "/workspace/work/glhf"

# Runs inside the sandbox with only the standard library. Checks shape, not correctness.
# "problems" mean the grader is likely to score the artifact zero or wrongly as it stands;
# "fatal" marks the ones the finisher is for (missing, empty, unparseable, no row-key column);
# "warnings" are legitimate in some tasks (one column, no rows, empty JSON) and need a human look.
# The delimiter follows the grader exactly (grading/loaders.py: load_table): the kind is the
# declared format, else the file suffix; csv and csv.gz are comma-separated; tsv, tab, txt,
# tsv.gz, bed and bed.gz are tab-separated. Files are read as utf-8-sig, because pandas (the
# grader) drops a byte-order mark and so must this check.
# Also warnings, never fatal, for what the grader matches as exact strings: a column the brief's
# Required Outputs names for the file and the header lacks ("required_columns" in the spec, from
# required_columns() below), and row keys with stray spaces or Ensembl version suffixes. Numbers
# written as "1,234" (pandas' to_numeric makes them NA) and infinite values are warned about too.
_CONTRACT_SCRIPT = r"""
import csv, gzip, json, os, re, sys
specs = json.loads(sys.argv[1])
csv.field_size_limit(1 << 30)
COMMA, TAB = ("csv", "csv.gz"), ("tsv", "tab", "txt", "tsv.gz", "bed", "bed.gz")
SNIFFED = ("table", "tabular")
NAME = {"\t": "tab", ",": "comma"}
ENSEMBL = re.compile(r"ENS[A-Z]*\d{6,}(\.\d+)?")
THOUSANDS = re.compile(r"[-+]?\d{1,3}(,\d{3})+(\.\d+)?")
INFINITE = ("inf", "-inf", "+inf", "infinity", "-infinity", "+infinity")
def squash(name): return re.sub(r"[\s_.\-]+", "", name.lower())
def opened(path):
    with open(path, "rb") as fh: magic = fh.read(2)
    if magic == b"\x1f\x8b": return gzip.open(path, "rt", encoding="utf-8-sig", newline="")
    return open(path, encoding="utf-8-sig", newline="")
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
    kind = fmt or os.path.splitext(path)[1].lstrip(".").lower()
    try:
        if kind == "json":
            with opened(path) as fh: data = json.load(fh)
            r["json_type"] = type(data).__name__
            if not data: r["warnings"].append("empty JSON (fine only if the result really is empty)")
        elif kind in COMMA or kind in TAB or kind in SNIFFED:
            with opened(path) as fh:
                first = fh.readline()
            tabs, commas = first.count("\t"), first.count(",")
            if kind in COMMA: delim = ","
            elif kind in TAB: delim = "\t"
            else:
                # Not a format the grader's table loader names: take the header line's delimiter.
                delim = "\t" if tabs >= commas and tabs else ","
                r["warnings"].append(f"format {kind!r} is not one the grader's table loader names (csv, tsv, tab, txt, bed); read as {NAME[delim]}-separated")
            r["delimiter"] = NAME[delim]
            with opened(path) as fh:
                rows = csv.reader(fh, delimiter=delim)
                header = next(rows, [])
                body = [row for _, row in zip(range(200000), rows)]
            r["columns"] = header[:40]; r["rows_checked"] = len(body)
            other = "," if delim == "\t" else "\t"
            if len(header) <= 1 and first.count(other):
                r["problems"].append(f"wrong delimiter: the grader reads {kind} as {NAME[delim]}-separated, the header line uses {NAME[other]}s")
                r["fatal"] = True
            elif len(header) <= 1:
                r["warnings"].append("single column (fine only if the brief asks for one column)")
            if not body:
                r["warnings"].append("header only, no rows (fine only if the result really is empty)")
            if key and not r["fatal"]:
                if key not in header:
                    r["problems"].append(f"row_key column {key!r} not in header"); r["fatal"] = True
                else:
                    i = header.index(key); keys = [row[i] for row in body if len(row) > i]
                    if len(set(keys)) != len(keys): r["problems"].append(f"duplicate {key!r} values")
                    if any(k.strip() == "" for k in keys): r["problems"].append(f"blank {key!r} values")
                    spaced = sum(1 for k in keys if k.strip() and k != k.strip())
                    if spaced: r["warnings"].append(f"{spaced} {key!r} values have leading or trailing spaces (the grader matches keys as exact strings)")
                    ens = [ENSEMBL.fullmatch(k) for k in keys]
                    versioned = sum(1 for m in ens if m and m.group(1))
                    plain = sum(1 for m in ens if m and not m.group(1))
                    if versioned and plain: r["warnings"].append(f"{key!r} mixes Ensembl IDs with a version suffix ({versioned}, e.g. .12) and without ({plain}); the grader matches keys as exact strings")
                    elif versioned: r["warnings"].append(f"{versioned} {key!r} values are Ensembl IDs with a version suffix (e.g. .12); the grader matches keys as exact strings: keep the suffix only if the brief or its inputs use it")
            for want in [] if r["fatal"] else s.get("required_columns") or []:
                if want in header: continue
                near = [h for h in header if squash(h) == squash(want)]
                if near: r["warnings"].append(f"column {near[0]!r} is named {want!r} in the brief's Required Outputs (the grader matches column names exactly)")
                else: r["warnings"].append(f"no column {want!r}, which the brief's Required Outputs names for this file (the grader matches column names exactly; ignore this if it is not a column of this file)")
            sample = body[:2000]
            for i, column in enumerate(header[:200]):
                if column == key: continue
                cells = [row[i].strip() for row in sample if len(row) > i]
                commas = sum(1 for c in cells if THOUSANDS.fullmatch(c))
                if commas: r["warnings"].append(f"column {column!r}: {commas} sampled numbers are written with thousands separators (e.g. 1,234), which the grader reads as NA")
                infinite = sum(1 for c in cells if c.lower() in INFINITE)
                if infinite: r["warnings"].append(f"column {column!r}: {infinite} sampled values are infinite; check how the brief wants them written")
            ragged = sum(1 for row in body if len(row) != len(header))
            if ragged: r["problems"].append(f"{ragged} rows with a different column count than the header")
            cells = [c.strip().lower() for row in body[:5000] for c in row]
            na = sum(c in ("", "na", "nan", "none", "null") for c in cells)
            if cells and na / len(cells) > 0.5: r["warnings"].append(f"{na}/{len(cells)} sampled cells are empty/NA")
    except Exception as e:
        r["problems"].append(f"could not parse: {e}"); r["fatal"] = True
print(json.dumps(report))
"""


CONTRACT_TIMEOUT = 120  # seconds for the shape check of all artifacts
SAVE_TIMEOUT = 60  # seconds for writing the ledger's working copy into the sandbox

_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
_OUTPUTS_HEADING = re.compile(r"(required|expected)\s+outputs?\b", re.IGNORECASE)
_ITEM = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+")
_BACKTICKED = re.compile(r"`([^`\n]+)`")
_COLUMN_WORD = re.compile(r"\bcolumns?\b", re.IGNORECASE)
_NOT_A_NAME = re.compile(r"[\s/\\<>=!()\[\]{}*|,;:'\"]")
_FILE_NAME = re.compile(
    r"\.(csv|tsv|tab|txt|json|md|bed|gz|h5ad|h5|rds|parquet|xlsx?)$", re.IGNORECASE
)
_NUMBER = re.compile(r"[-+]?\d*\.?\d+(e[-+]?\d+)?", re.IGNORECASE)
MAX_REQUIRED_COLUMNS = 40  # per artifact; a brief that names more is not listing columns


def _required_outputs_section(brief: str) -> str:
    """The text under the brief's "Required Outputs" (or "Expected Outputs") heading, up to the
    next heading of the same or a higher level. "" when the brief has no such heading."""
    lines, level, out = brief.splitlines(), 0, []
    for line in lines:
        heading = _HEADING.match(line)
        if level:
            if heading and len(heading.group(1)) <= level:
                break
            out.append(line)
        elif heading and _OUTPUTS_HEADING.search(heading.group(2)):
            level = len(heading.group(1))
    return "\n".join(out)


def _items(section: str) -> list[str]:
    """The section split into list items and sub-headed blocks (with their continuation lines);
    text before the first item is one item of its own."""
    items: list[str] = []
    for line in section.splitlines():
        if _ITEM.match(line) or _HEADING.match(line) or not items:
            items.append(line)
        else:
            items[-1] += "\n" + line
    return [item for item in items if item.strip()]


def required_columns(brief: str, outputs: list[ExpectedOutput]) -> dict[str, list[str]]:
    """Column names the brief's Required Outputs section names for each artifact, by artifact id.

    Read from the text, so it can be wrong: the names are backticked words in the list item that
    names the file (the whole section when there is one artifact), and only in an item that says
    "column". They feed warnings of the contract check, never a fatal problem. The grader matches
    column names as exact strings, and the models alone checked them until now."""
    section = _required_outputs_section(brief)
    if not section.strip():
        return {}
    items = _items(section)
    files = {PurePosixPath(o.path).name for o in outputs}
    found: dict[str, list[str]] = {}
    for output in outputs:
        name = PurePosixPath(output.path).name
        mentions = re.compile(r"(?<![\w.-])" + re.escape(name) + r"(?![\w-])")
        mine = [item for item in items if mentions.search(item)]
        if not mine and len(outputs) == 1:
            mine = [section]
        names: list[str] = []
        for item in mine:
            if not _COLUMN_WORD.search(item):
                continue
            for token in _BACKTICKED.findall(item):
                token = token.strip()
                if (
                    token
                    and len(token) <= 64
                    and token not in files
                    and not _NOT_A_NAME.search(token)
                    and not _FILE_NAME.search(token)
                    and not _NUMBER.fullmatch(token)
                    and token not in names
                ):
                    names.append(token)
        if names and len(names) <= MAX_REQUIRED_COLUMNS:
            found[output.artifact_id] = names
    return found


async def check_contract(
    outputs: list[ExpectedOutput],
    root: str | None = None,
    columns: dict[str, list[str]] | None = None,
) -> list[dict[str, Any]]:
    """Shape-check the required artifacts. `root` checks a copy of the tree, e.g. the pilot's.
    `columns`: the brief's required column names per artifact id (required_columns), warned about
    when the header lacks them."""
    specs = [
        {
            **o.model_dump(),
            "sandbox_path": o.sandbox_path,
            "required_columns": (columns or {}).get(o.artifact_id, []),
        }
        for o in outputs
    ]
    if root:
        for spec in specs:
            spec["sandbox_path"] = root.rstrip("/") + spec["sandbox_path"].removeprefix("/outputs")
    try:
        result = await sandbox().exec(
            ["python3", "-c", _CONTRACT_SCRIPT, json.dumps(specs)], timeout=CONTRACT_TIMEOUT
        )
        failure = None if result.success else result.stderr[-500:]
    except TimeoutError:
        # A stuck sandbox must not hold the run for ten minutes at every check (it did, once).
        failure = f"no answer from the sandbox in {CONTRACT_TIMEOUT} s"
    if failure is not None:
        return [{"artifact_id": "*", "problems": [f"contract check failed to run: {failure}"]}]
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


def check_failed(report: list[dict[str, Any]]) -> bool:
    """The check itself could not run (reported as artifact "*"): nothing is known about any file."""
    return any(r.get("artifact_id") == "*" for r in report)


def needs_rescue(report: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Artifacts the finisher is for: missing, empty, unparseable or without the row-key column.

    A check that could not run names no artifact and is not a reason to start the finisher: it
    has nothing to fix and could only damage artifacts that are fine."""
    return [r for r in report if r.get("fatal") and r.get("artifact_id") != "*"]


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


# The record of a run is kept by the solver process, never read back from the sandbox: a role
# can rewrite any file under /workspace or /outputs (one left a loop doing it), so those copies
# are for the roles to read and are not evidence. The trusted copy is in the sample's store
# (it ends in the Inspect log) and, when HOST_LEDGER_ENV names a folder on the host, in
# <folder>/ledger.json and <folder>/FINDINGS.md.
LEDGER_STORE_KEY = "glhf:ledger"
FINDINGS_STORE_KEY = "glhf:findings"
HOST_LEDGER_ENV = "GLHF_HOST_LEDGER_DIR"
HOST_LEDGER_FILE = "ledger.json"
HOST_FINDINGS_FILE = "FINDINGS.md"


def write_host_file(file: Path, text: str) -> None:
    """Write in one step (temporary file, then rename), so a reader never sees half a file."""
    file.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(dir=file.parent, prefix=f".{file.name}.")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as out:
            out.write(text)
        os.replace(temporary, file)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def persist_ledger(ledger: Ledger) -> None:
    """Keep the trusted copy of the ledger: straight from this process's memory."""
    text, findings = ledger.to_json(), ledger.findings_markdown()
    store().set(LEDGER_STORE_KEY, text)
    store().set(FINDINGS_STORE_KEY, findings)
    folder = os.environ.get(HOST_LEDGER_ENV)
    if folder:
        write_host_file(Path(folder) / HOST_LEDGER_FILE, text)
        write_host_file(Path(folder) / HOST_FINDINGS_FILE, findings)


async def save_ledger(ledger: Ledger) -> None:
    """Persist the ledger (trusted copy first), then refresh the copy the roles can read.
    The sandbox copy has a time limit: a sandbox that does not answer must not stop the run."""
    persist_ledger(ledger)
    try:
        with anyio.fail_after(SAVE_TIMEOUT):
            await sandbox().exec(["mkdir", "-p", WORK], timeout=SAVE_TIMEOUT)
            await sandbox().write_file(f"{WORK}/ledger.json", ledger.to_json())
    except TimeoutError:
        if not any(e.get("kind") == "ledger.sandbox_copy_timeout" for e in ledger.events):
            ledger.log("ledger.sandbox_copy_timeout", seconds=SAVE_TIMEOUT)
            persist_ledger(ledger)


@tool
def check_outputs(
    outputs: list[ExpectedOutput], columns: dict[str, list[str]] | None = None
) -> Tool:
    async def execute() -> str:
        """Deterministically check every required output file: present, non-empty, parseable,
        row_key column present and unique, delimiter and column counts consistent.
        This checks shape only, not scientific correctness. Lines under "Warnings" (one column,
        no rows, empty JSON, mostly NA, a column name or key format the grader may not match)
        are not failures: compare them with the brief.
        Run it before declaring any artifact done."""
        return contract_text(await check_contract(outputs, columns=columns))

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


# A registered test is a script. The harness runs it; these are the only ways it is started.
# The registered content is given on standard input, so what runs is what was hashed at
# registration, whatever happens to the file afterwards.
INTERPRETERS: dict[str, list[str]] = {
    ".py": ["python3", "-"],
    ".sh": ["bash", "-s"],
    ".r": ["Rscript", "-"],
}
TEST_ROOT = "/workspace/"  # a test script must be under it
TEST_SECONDS = 300  # the most one registered test may run
MIN_TEST_SECONDS = 10  # with less time than this a test is not started


def _script_suffix(path: str) -> str:
    return posixpath.splitext(path)[1].lower()


def script_path_problem(path: str) -> str | None:
    """Why `path` cannot be a registered test script, or None."""
    if not path.startswith(TEST_ROOT) or posixpath.normpath(path) != path:
        return f"script_path must be a plain absolute path under {TEST_ROOT}"
    if _script_suffix(path) not in INTERPRETERS:
        return f"script_path must end in one of {', '.join(sorted(INTERPRETERS))} (any case)"
    return None


async def read_script(path: str) -> str | None:
    """The text of a script in the sandbox, or None when there is no readable text file."""
    try:
        return await sandbox().read_file(path)
    except Exception:
        return None


async def run_registered_test(entry: Registration, seconds: int) -> Run:
    """Execute a registered test script in the sandbox and report what was seen. Harness code:
    no model takes part. The file at the registered path must still have the registered hash;
    what is executed is the registered content itself; the result is the last line of stdout."""
    assert entry.script_path and entry.script_sha256
    command = INTERPRETERS[_script_suffix(entry.script_path)]
    found = await read_script(entry.script_path)
    if found is None:
        return Run("missing", command, detail="no readable file at the registered path")
    now = hashlib.sha256(found.encode("utf-8")).hexdigest()
    if now != entry.script_sha256:
        return Run(
            "changed", command, sha256_at_run=now, detail="the file changed after registration"
        )
    began = time.monotonic()
    try:
        result = await sandbox().exec(
            command, input=entry.script, cwd=WORK, timeout=max(1, seconds), timeout_retry=False
        )
    except TimeoutError:
        return Run(
            "timeout",
            command,
            seconds=time.monotonic() - began,
            sha256_at_run=now,
            detail=f"no result in {seconds} s",
        )
    except Exception as error:  # output too large, sandbox gone: no result
        return Run(
            "failed",
            command,
            seconds=time.monotonic() - began,
            sha256_at_run=now,
            detail=str(error)[:300],
        )
    took = time.monotonic() - began
    tail = result.stdout[-OUTPUT_TAIL_CHARS:]
    if result.stderr.strip():
        tail = (tail + "\n[stderr]\n" + result.stderr[-500:])[-OUTPUT_TAIL_CHARS:]
    if not result.success:
        return Run("failed", command, result.returncode, took, tail, now, detail="non-zero exit")
    parsed = parse_result_line(result.stdout)
    if parsed is None:
        return Run(
            "unparsable",
            command,
            result.returncode,
            took,
            tail,
            now,
            detail=f"the last line of stdout is not: {RESULT_LINE}",
        )
    return Run("ok", command, result.returncode, took, tail, now, parsed[0], parsed[1])


def _check_own_claim(only_claim: str | None, claim_id: str) -> None:
    """In the claims engine a critic works on one claim: it may not test or refute another one."""
    if only_claim is not None and claim_id != only_claim:
        raise ToolError(f"this critic works on {only_claim} only, not on {claim_id}")


@tool
def register_falsification_test(ledger: Ledger, role: str, only_claim: str | None = None) -> Tool:
    async def execute(
        claim_id: str, test_name: str, method: str, script_path: str, test_null: str
    ) -> str:
        """Pre-register a falsification test for a claim: a script file that IS the test.

        Write the script first, then register it, BEFORE any test of that claim has a result.
        The content of the file is hashed now. You do not run it and you do not report its
        p-value: after your turn a separate judge rates whether the test bears on the claim
        (it sees the claim and this registration, no results), and then the harness runs the
        registered file and reads the result from its LAST line of standard output, which must
        be exactly:

            GLHF_RESULT p_value=<number in [0, 1]> contradicts=<true|false>

        p_value is the p-value under the test's null, computed by the script from the data;
        contradicts=true when the observed effect goes against the claim. The script must run
        with no arguments from /workspace/work/glhf (python3, bash or Rscript, by suffix .py,
        .sh, .R), use absolute paths, be deterministic (fix every seed) and finish within a few
        minutes. Do not change the file after registering it: a changed, failing, slow or
        silent script has no result, which counts as zero and keeps the claim from being
        supported. So does a test the judge finds not relevant.

        At most 3 tests per claim, each one a check whose result would be unlikely if the claim
        were false (permutation of sample labels, held-out replicate, negative-control gene
        set, alternative method, direction check against a known marker). Registration closes
        when the claim gets its first result.

        Args:
            claim_id: Claim id, e.g. "C3".
            test_name: Short name of the test.
            method: What the script does (data, statistic, number of permutations) and which
                outcome would contradict the claim.
            script_path: Absolute path of the script, under /workspace/.
            test_null: The null hypothesis the script's p-value is computed under, in one
                sentence. It should be true whenever the claim's null is true.
        """
        _check_own_claim(only_claim, claim_id)
        if claim_id not in ledger.claims:
            raise ToolError(f"unknown claim {claim_id}; known: {', '.join(ledger.claims)}")
        problem = script_path_problem(script_path)
        if problem:
            raise ToolError(problem)
        script = await read_script(script_path)
        if script is None:
            raise ToolError(f"no readable text file at {script_path}: write the script first")
        try:
            claim = ledger.register_test(
                claim_id,
                test_name,
                method,
                role,
                script_path=script_path,
                script=script,
                test_null=test_null,
            )
        except ValueError as e:
            raise ToolError(str(e)) from e
        await save_ledger(ledger)
        entry = claim.registered[-1]
        assert entry.script_sha256
        return (
            f"{claim.id}: registered {len(claim.registered)} test(s): "
            + ", ".join(r.name for r in claim.registered)
            + f". {entry.name} is {script_path}, sha256 {entry.script_sha256[:12]}. Do not change "
            "or run-and-report it: it will be judged for relevance and then run by the harness."
        )

    return execute


@tool
def record_falsification_test(ledger: Ledger, role: str, only_claim: str | None = None) -> Tool:
    async def execute(
        claim_id: str, test_name: str, p_value: float, contradicts: bool, note: str
    ) -> str:
        """Report a result that CONTRADICTS a claim, from code you ran in the sandbox.

        Only for results that go against the claim (contradicts=true): such a result is always
        accepted, it lowers the claim's evidence and it can refute the claim. A favourable
        result cannot be reported here and is refused: support comes only from registered test
        scripts, which the harness runs itself (see register_falsification_test).

        Args:
            claim_id: Claim id, e.g. "C3".
            test_name: A short name for what you ran.
            p_value: p-value under the null, from code you ran. Never estimate it.
            contradicts: Must be true.
            note: What you ran (script path) and what you observed.
        """
        _check_own_claim(only_claim, claim_id)
        if claim_id not in ledger.claims:
            raise ToolError(f"unknown claim {claim_id}; known: {', '.join(ledger.claims)}")
        try:
            claim = ledger.record_test(claim_id, test_name, p_value, contradicts, note, role)
        except ValueError as e:
            raise ToolError(str(e)) from e
        await save_ledger(ledger)
        waiting = f" Still without a result: {', '.join(claim.pending)}." if claim.pending else ""
        return f"{claim.id}: verdict {claim.verdict}, mean e-value {claim.e_value:.3g}.{waiting}"

    return execute


@tool
def report_failed_replication(ledger: Ledger, role: str, only_claim: str | None = None) -> Tool:
    async def execute(claim_id: str, note: str) -> str:
        """Mark a claim refuted because an independent re-implementation did not reproduce it.

        Args:
            claim_id: Claim id.
            note: What was re-implemented, and the discrepancy (numbers).
        """
        _check_own_claim(only_claim, claim_id)
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
# only: no journals, preprint servers, code hosts, code mirrors, data repositories, package
# indexes (anyone can publish a data package or a project page there) or question-and-answer
# sites (threads can be about one paper). Where a host also serves data packages or arbitrary
# projects, only named path prefixes or named projects are allowed.
# The allow-list is enforced twice: Exa is asked for these domains only, and every returned URL is
# checked here again, against the list, its path rules and the case's own network policy.
# Residual risk: a tool's own manual can quote a public dataset in an example.
DOC_DOMAINS = [
    "bioconductor.org",
    "readthedocs.io",
    "htslib.org",
    "support.10xgenomics.com",
    "nf-co.re",
    "training.galaxyproject.org",
    "hbctraining.github.io",
    "satijalab.org",
    "docs.python.org",
]
# bioconductor.org: software package pages, manuals and vignettes only. Experiment-data packages
# (/packages/*/data/experiment/), annotation data and workflows can carry a study's own data, and
# /help/ holds /help/workflows/, /help/publications/ and /help/course-materials/: worked analyses
# of named datasets. support.10xgenomics.com: the software documentation only; the same host
# serves the dataset pages (/<product>/datasets/...), and a data repository may not be searched.
_PATH_RULES: dict[str, re.Pattern[str]] = {
    "bioconductor.org": re.compile(
        r"^/(?:packages/(?:release|devel|\d+\.\d+)/bioc/|install(?:/|$))"
    ),
    "support.10xgenomics.com": re.compile(
        r"^/(?!.*/datasets?(?:/|$))(?:[a-z0-9-]+/software/|docs(?:/|$)|[a-z0-9-]+/docs(?:/|$))"
    ),
}
# A page of a manual is a page, not a table: files in these formats are data, whatever host
# serves them (a tutorial site keeps the dataset it analyses next to its lessons).
_DATA_FILE = re.compile(
    r"\.(?:csv|tsv|tab|txt|xls|xlsx|ods|rds|rda|rdata|h5|h5ad|hdf5|loom|mtx|json|jsonl|parquet|"
    r"feather|gz|bgz|bz2|xz|zst|zip|tar|tgz|7z|bam|cram|sam|vcf|bcf|bed|bedgraph|bw|bigwig|gtf|"
    r"gff|gff3|fa|fasta|fastq|fq|sqlite|db|pkl|pickle|npy|npz|mat)$",
    re.IGNORECASE,
)
# readthedocs.io hosts any project anyone creates; only these tool manuals are allowed. Every
# slug here must be a project that exists: a slug nobody has registered can be registered by
# anyone, who then publishes under an allow-listed host. 40 such slugs were removed (subread,
# gatk, samtools, hisat2, bwa, multiqc, ...; the list is READTHEDOCS_UNREGISTERED in
# tests/unit/test_redteam_guards.py). Check that a project exists before adding it.
READTHEDOCS_PROJECTS = frozenset(
    "salmon kallisto pysam bedtools deeptools cutadapt htseq gffutils pyranges scanpy anndata "
    "squidpy muon episcanpy scvelo cellrank bbknn leidenalg umap-learn pandas numpy scipy "
    "scikit-learn matplotlib snakemake gseapy pydeseq2 decoupler pertpy mudata pyensembl mygene "
    "goatools sourmash khmer qiime2 bismark pyvcf umi-tools spades bakta picard snpeff "
    "cnvkit".split()
)
MAX_SEARCHES = 20  # per run, all roles together; a failed call counts
# Verbatim from Exa's build-with-exa skill: the description of the `objective` parameter.
_OBJECTIVE = (
    "Goal for this search turn; say which documents should rank first, which should be excluded, "
    "and what specific facts or figures to pull from them."
)


# Words that point at where a paper, its code or its supplement lives. Refused in a query (no
# tool manual is found by them), not in the text of a result: a manual may say "GitHub".
_PAPER_PLACES = re.compile(
    r"(?<![A-Za-z])(?:github|gitlab|bitbucket|arxiv|sciencedirect|nature\.com|cell\.com|"
    r"springer|wiley|pre-?prints?|supplementary (?:tables?|data|files?|materials?|information)|"
    r"series matrix|ncbi geo|geo series|sci-?hub)(?![A-Za-z])",
    re.IGNORECASE,
)


def query_refusal(
    text: str,
    doi: str | None = None,
    titles: Sequence[str] = (),
    authors: Sequence[str] = (),
    *,
    places: bool = True,
) -> str | None:
    """Why a search text is refused, or None. Checked on the query and the objective, and
    (with `places=False`) on the title and highlights of every result.

    `titles` (the paper's title) and `authors` (surnames) are compared when the case provides
    them; the BixBench3 metadata has neither today, so in benchmark runs both are empty."""
    found = study_identifier(text)
    if found:
        return f"it contains a study or dataset identifier ({found!r})"
    if doi and names_doi(text, doi):
        return "it contains the study's DOI"
    if places:
        place = _PAPER_PLACES.search(normalise(text))
        if place:
            return f"it points at a paper, its code or its supplement ({place.group(0)!r})"
    for title in titles:
        phrase = shared_phrase(text, title)
        if phrase:
            return f"it repeats words of the study's title ({phrase!r})"
    surname = names_person(text, list(authors))
    if surname:
        return f"it names an author of the study ({surname!r})"
    return None


def _same_page(host: str, path: str) -> tuple[str, str]:
    """A URL's host and path in the form answer sources are compared in: percent-decoded,
    lower-case, without "index", ".html" or a trailing slash, and on readthedocs.io without the
    language and version ("/en/latest/", "/en/stable/" and "/en/v1.2/" are one manual)."""
    parts = [p for p in unquote(unquote(path)).lower().split("/") if p]
    if host.endswith(".readthedocs.io") and len(parts) >= 2 and len(parts[0]) <= 5:
        parts = parts[2:]
    if parts:
        parts[-1] = re.sub(r"\.html?$", "", parts[-1])
        if parts[-1] == "index":
            parts.pop()
    return host, "/" + "/".join(parts)


def result_block_reason(url: str, policy: NetworkAccessPolicy | None = None) -> str | None:
    """Why a returned URL is dropped, or None. The case's policy wins over the allow-list."""
    raw = url.strip()
    if "\\" in raw or any(ord(c) < 33 for c in raw):
        return "URL contains a backslash, a space or a control character"
    try:
        parts = urlsplit(raw)
        if parts.username is not None or parts.password is not None or "@" in parts.netloc:
            return "URL carries user information before the host"
        normalized = normalize_url(raw)
        host = host_from_url(raw)
    except ValueError:
        return "not an http(s) URL"
    # The path as it was written. A dot segment, an encoded dot or slash, a doubled slash or a
    # ";" parameter makes the path that a server answers differ from the path that is checked.
    written = parts.path.lower()
    if "/." in unquote(written) or any(
        mark in written for mark in ("%2e", "%2f", "%5c", "%25", ";", "//")
    ):
        return "path has dot segments, encoded separators, ';' or '//'"
    carried = f"{parts.query}#{parts.fragment}".lower()
    if any(mark in unquote(unquote(carried)) for mark in ("//", "http", "www.")):
        return "another address is carried in the query or the fragment"
    if _DATA_FILE.search(unquote(parts.path)):
        return "a data file, not a page of a manual"
    restricted = [*RESTRICTED_DOMAIN_SCOPES, *(policy.restricted_domain_scopes if policy else [])]
    if any(domain_matches(host, d) for d in restricted):
        return "host is a restricted code or data host"
    if policy:
        if any(domain_matches(host, d) for d in policy.answer_source_domains):
            return "host is an answer source for this task"
        page_host, page = _same_page(host, parts.path)
        for source in policy.answer_source_urls:
            try:
                if normalized.startswith(normalize_url(source).rstrip("/")):
                    return "URL is an answer source for this task"
                # The same page under another scheme, port, encoding or manual version.
                source_host, source_page = _same_page(
                    host_from_url(source), urlsplit(source.strip()).path
                )
            except ValueError:
                continue
            if page_host == source_host and (
                page == source_page or page.startswith(source_page.rstrip("/") + "/")
            ):
                return "URL is an answer source for this task"
    domain = next((d for d in DOC_DOMAINS if domain_matches(host, d)), None)
    if domain is None:
        return "host is not on the documentation allow-list"
    if domain == "readthedocs.io":
        project = host.removesuffix(".readthedocs.io")
        if host == "readthedocs.io" or project not in READTHEDOCS_PROJECTS:
            return "not one of the named tool manuals on readthedocs.io"
    rule = _PATH_RULES.get(domain)
    if rule:
        # A host with path rules is allowed as itself only: its subdomains (for example the
        # support forum) are other sites.
        if host not in (domain, f"www.{domain}"):
            return f"only {domain} itself is allowed, not its subdomains"
        if not rule.match(urlsplit(normalized).path):
            return f"path is outside the documentation part of {domain}"
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
    ledger: Ledger,
    role: str,
    policy: NetworkAccessPolicy | None = None,
    doi: str | None = None,
    titles: Sequence[str] = (),
    authors: Sequence[str] = (),
) -> Tool:
    async def execute(query: str, objective: str) -> str:
        """Search software documentation (tool manuals; not papers, not data, not forums).

        Use it for tool usage, parameters, file formats, error messages and version differences.
        It cannot and must not be used to look up the study being reproduced or its results:
        a query with a DOI, an accession or a paper identifier is refused, and the run has a
        fixed number of searches.

        Args:
            query: What to retrieve, as plain natural-language intent, e.g. "featureCounts
                reverse-stranded paired-end -s 2 -p option".
            objective: OBJECTIVE_PLACEHOLDER
        """
        if paid.paid_calls_off():  # NO_PAID_CALLS: before the key, the ledger or the network
            raise ToolError(f"search is not available: {paid.HOW_TO_ALLOW}")
        key = os.environ.get("EXA_API_KEY")
        if not key:
            raise ToolError("search is not available: EXA_API_KEY is not set on the runner")

        async def refuse(reason: str) -> ToolError:
            ledger.log("search.refused", by=role, query=query[:300], reason=reason)
            await save_ledger(ledger)
            return ToolError(f"search refused: {reason}")

        # Calls that reached the search engine, finished or not. The slot is taken before the
        # first await, so parallel calls cannot pass the cap together, and a failed call counts.
        used = sum(1 for e in ledger.events if e.get("kind") in ("search", "search.started"))
        if used >= MAX_SEARCHES:
            raise await refuse(f"the run's limit of {MAX_SEARCHES} searches is used up")
        reason = query_refusal(f"{query}\n{objective}", doi, titles, authors)
        if reason:
            raise await refuse(reason + "; search_docs is for software documentation only")
        started: dict[str, object] = {"kind": "search.started", "by": role, "query": query}
        ledger.events.append(started)
        try:
            body = await exa_docs(query, objective, key)
        except Exception as error:
            started.update(kind="search", urls=[], dropped=[], failed=str(error)[:200])
            await save_ledger(ledger)
            raise
        results, dropped = [], []
        for r in body.get("results", []):
            why = result_block_reason(str(r.get("url") or ""), policy)
            if not why:
                # The title and the highlights are what the role reads: they are checked like
                # a query, so a manual page that quotes the study is dropped with its text.
                shown = f"{r.get('title') or ''}\n" + "\n".join(map(str, r.get("highlights") or []))
                named = query_refusal(shown, doi, titles, authors, places=False)
                why = f"its text names the study: {named}" if named else None
            if why:
                dropped.append({"url": r.get("url"), "reason": why})
            else:
                results.append(r)
        started.update(kind="search", urls=[r.get("url") for r in results], dropped=dropped)
        await save_ledger(ledger)
        if not results:
            return "Nothing relevant found on the documentation sites."
        lines = [
            f"- {r.get('title') or r.get('url')}\n  {r.get('url')}\n  "
            + " ".join(" ".join(r.get("highlights") or []).split())[:700]
            for r in results[:8]
        ]
        # A notice is free text from the engine. It is passed on only when it is short, has
        # no address in it and passes the same check as a query; anything else is dropped.
        notices = []
        for notice in body.get("notices", []):
            message = " ".join(str(notice.get("message", "")).split())[:300]
            if (
                message
                and not re.search(r"https?:|www\.|://|\w\.\w{2,}/", message, re.IGNORECASE)
                and query_refusal(message, doi, titles, authors) is None
            ):
                notices.append(f"Note from the search engine: {message}")
        return "\n".join(lines + notices)

    assert execute.__doc__
    execute.__doc__ = execute.__doc__.replace("OBJECTIVE_PLACEHOLDER", _OBJECTIVE)
    return execute


# -- Claims engine (engine.py) ---------------------------------------------------------------------
MAX_CLAIMS = 8  # triage names 3 to 8 claims


@tool(name="propose_claim")
def triage_claim(ledger: Ledger, role: str, acuities: dict[str, str]) -> Tool:
    async def execute(
        text: str,
        artifact_ids: list[str],
        null_hypothesis: str,
        acuity: Literal["high", "medium", "low"],
    ) -> str:
        """Register a falsifiable claim and its priority. The run's budget is shared out by
        priority: high gets three times what low gets. Name 3 to 8 claims, the most promising
        first; a weak claim is dropped cheaply at the pilot.

        Args:
            text: The claim, one sentence, specific and testable.
            artifact_ids: Required artifacts the claim depends on.
            null_hypothesis: What would be true if the claim were false.
            acuity: high, medium or low: how much of the budget the claim deserves.
        """
        if len(ledger.claims) >= MAX_CLAIMS:
            raise ToolError(f"{MAX_CLAIMS} claims are registered, the most a run may have")
        if acuity not in ("high", "medium", "low"):
            raise ToolError("acuity must be high, medium or low")
        claim = ledger.add_claim(text, artifact_ids, null_hypothesis, role)
        acuities[claim.id] = acuity
        await save_ledger(ledger)
        return f"Registered {claim.id} ({acuity})."

    return execute


@tool
def claim_done(done: dict[str, tuple[str, str]], key: str) -> Tool:
    async def execute(status: Literal["ok", "failed"], note: str) -> str:
        """End your work on this claim. Call it once, last. "ok": the files the task asked for are
        written in the claim's folder. "failed": they could not be made; say why in the note.
        Code checks the files either way; what you write here does not decide anything.

        Args:
            status: ok or failed.
            note: One or two sentences: what you did, or why it failed.
        """
        if status not in ("ok", "failed"):
            raise ToolError("status must be ok or failed")
        done[key] = (status, note.strip()[:500])
        return "Recorded. Now submit."

    return execute


@tool(name="raise_issue")
def raise_claim_issue(ledger: Ledger, role: str, claim_id: str) -> Tool:
    async def execute(
        severity: Literal["blocking", "major", "minor"],
        artifact_ids: list[str],
        problem: str,
        evidence: str,
    ) -> str:
        """Raise a problem with this claim's analysis that must be fixed before it can be supported.
        blocking = artifact is missing, malformed, or computed from the wrong samples/contrast;
        major = method deviates from the guidance or a QC check fails; minor = documentation gaps.
        An open blocking or major issue sends the claim back for revision.

        Args:
            severity: blocking, major or minor.
            artifact_ids: Affected required artifacts.
            problem: What is wrong, one or two sentences.
            evidence: The command you ran and the output that shows it.
        """
        issue = ledger.raise_issue(severity, artifact_ids, problem, evidence, role, [claim_id])
        await save_ledger(ledger)
        return f"Raised {issue.id} on {claim_id}."

    return execute
