"""Tools the swarm roles share. The ledger tools are bound to one role so every entry is attributed."""

from __future__ import annotations

import json
import os
import re
import tempfile
from collections.abc import Sequence
from pathlib import Path
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
from .guards import names_person, normalise, shared_phrase, study_identifier
from .ledger import Ledger

WORK = "/workspace/work/glhf"

# Runs inside the sandbox with only the standard library. Checks shape, not correctness.
# "problems" mean the grader is likely to score the artifact zero or wrongly as it stands;
# "fatal" marks the ones the finisher is for (missing, empty, unparseable, no row-key column);
# "warnings" are legitimate in some tasks (one column, no rows, empty JSON) and need a human look.
# The delimiter follows the grader exactly (grading/loaders.py: load_table): the kind is the
# declared format, else the file suffix; csv and csv.gz are comma-separated; tsv, tab, txt,
# tsv.gz, bed and bed.gz are tab-separated. Files are read as utf-8-sig, because pandas (the
# grader) drops a byte-order mark and so must this check.
_CONTRACT_SCRIPT = r"""
import csv, gzip, json, os, sys
specs = json.loads(sys.argv[1])
csv.field_size_limit(1 << 30)
COMMA, TAB = ("csv", "csv.gz"), ("tsv", "tab", "txt", "tsv.gz", "bed", "bed.gz")
SNIFFED = ("table", "tabular")
NAME = {"\t": "tab", ",": "comma"}
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


async def check_contract(
    outputs: list[ExpectedOutput], root: str | None = None
) -> list[dict[str, Any]]:
    """Shape-check the required artifacts. `root` checks a copy of the tree, e.g. the pilot's."""
    specs = [{**o.model_dump(), "sandbox_path": o.sandbox_path} for o in outputs]
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
def register_falsification_test(ledger: Ledger, role: str) -> Tool:
    async def execute(claim_id: str, test_name: str, method: str) -> str:
        """Pre-register a falsification test for a claim, BEFORE you run it or any other test of
        that claim. Only registered tests can support a claim.

        Decide the tests first: at most 3 per claim, each one a check whose result would be
        unlikely if the claim were false (permutation of sample labels, held-out replicate,
        negative-control gene set, alternative method, direction check against a known marker).
        Registration closes when the claim gets its first result, and every registered test
        must then be run and recorded: one left without a result counts as zero and the claim
        cannot be supported. Do not try a test first and register it afterwards.

        Args:
            claim_id: Claim id, e.g. "C3".
            test_name: Short name; use the same name when you record the result.
            method: What you will run (data, statistic, number of permutations) and which
                outcome would contradict the claim.
        """
        if claim_id not in ledger.claims:
            raise ToolError(f"unknown claim {claim_id}; known: {', '.join(ledger.claims)}")
        try:
            claim = ledger.register_test(claim_id, test_name, method, role)
        except ValueError as e:
            raise ToolError(str(e)) from e
        await save_ledger(ledger)
        return f"{claim.id}: registered {len(claim.registered)} test(s): " + ", ".join(
            r.name for r in claim.registered
        )

    return execute


@tool
def record_falsification_test(ledger: Ledger, role: str) -> Tool:
    async def execute(
        claim_id: str, test_name: str, p_value: float, contradicts: bool, note: str
    ) -> str:
        """Record the result of a falsification test you actually ran in the sandbox.

        The test must have been registered with register_falsification_test before any test of
        the claim was run; use the registered name. Report the p-value of the observed result
        under the claim's null hypothesis, from code you ran. Set contradicts=true when the result
        goes against the claim; a contradicting result is always accepted, registered or not.
        The verdict is computed by code: alpha=0.1 is shared across all claims, and a claim is
        supported only when every registered test has a result and the mean of their e-values
        reaches the threshold read_ledger shows. Record every registered test, favourable or not;
        one result per test name, and the first result stands.

        Args:
            claim_id: Claim id, e.g. "C3".
            test_name: The registered name of the test.
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
        waiting = f" Still without a result: {', '.join(claim.pending)}." if claim.pending else ""
        return f"{claim.id}: verdict {claim.verdict}, mean e-value {claim.e_value:.3g}.{waiting}"

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
# (/packages/*/data/experiment/), annotation data and workflows can carry a study's own data.
_PATH_RULES: dict[str, re.Pattern[str]] = {
    "bioconductor.org": re.compile(
        r"^/(?:packages/(?:release|devel|\d+\.\d+)/bioc/|help/|install/?)"
    ),
}
# readthedocs.io hosts any project anyone creates; only these tool manuals are allowed.
READTHEDOCS_PROJECTS = frozenset(
    "subread star-aligner hisat2 salmon kallisto pachterlab-kallisto bowtie-bio bowtie2 bwa "
    "samtools pysam bedtools deeptools macs3 macs2 multiqc fastqc cutadapt trimgalore htseq "
    "rsem stringtie gffread gffutils pyranges pybedtools scanpy anndata scvi-tools squidpy muon "
    "episcanpy scvelo cellrank harmonypy bbknn leidenalg umap-learn pandas numpy scipy "
    "statsmodels scikit-learn matplotlib seaborn snakemake nextflow biopython gseapy pydeseq2 "
    "decoupler pertpy mudata snapatac2 pyensembl mygene goatools sourmash khmer qiime2 dada2 "
    "bismark methylpy pyfaidx cyvcf2 pyvcf bcbio-gff umi-tools fastp spades quast busco prokka "
    "bakta gatk picard varscan freebayes snpeff cnvkit homer chipseeker rseqc qualimap".split()
)
MAX_SEARCHES = 20  # per run, all roles together; a failed call counts
# Verbatim from Exa's build-with-exa skill: the description of the `objective` parameter.
_OBJECTIVE = (
    "Goal for this search turn; say which documents should rank first, which should be excluded, "
    "and what specific facts or figures to pull from them."
)


def query_refusal(
    text: str,
    doi: str | None = None,
    titles: Sequence[str] = (),
    authors: Sequence[str] = (),
) -> str | None:
    """Why a search text is refused, or None. Checked on the query and on the objective.

    `titles` (the paper's title) and `authors` (surnames) are compared when the case provides
    them; the BixBench3 case record has neither today, so the solver passes none."""
    found = study_identifier(text)
    if found:
        return f"it contains a study or dataset identifier ({found!r})"
    plain = normalise(text).lower()
    if doi:
        squeeze = re.compile(r"[\s/]|%2f")
        if doi.lower() in plain or squeeze.sub("", doi.lower()) in squeeze.sub("", plain):
            return "it contains the study's DOI"
    for title in titles:
        phrase = shared_phrase(text, title)
        if phrase:
            return f"it repeats words of the study's title ({phrase!r})"
    surname = names_person(text, list(authors))
    if surname:
        return f"it names an author of the study ({surname!r})"
    return None


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
        notices = [f"Note from the search engine: {n['message']}" for n in body.get("notices", [])]
        return "\n".join(lines + notices)

    assert execute.__doc__
    execute.__doc__ = execute.__doc__.replace("OBJECTIVE_PLACEHOLDER", _OBJECTIVE)
    return execute
