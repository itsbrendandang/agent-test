"""Run one case on this machine with either solver, then grade it with the official grader.

    uv run python -m bixbench3.glhf_local --case ../demo_case --solver glhf --model mock --out runs/demo-glhf
    uv run python -m bixbench3.glhf_local --case ../demo_case --solver single --model anthropic/claude-opus-5 --out runs/demo-single

For the demo case and for tests. Real BixBench3 tasks need the cloud runner (`bixbench3 run`):
their data is 8 to 259 GB and they need the full runtime image.

`--model mock` plays a fixed script and needs no API key. It proves the plumbing, not the science.

Layout of --out:
  workspace/ outputs/   mounted into the sandbox; everything in them is written by the agents
  graded/               regular files copied out of outputs/ after the run; the grader reads these
  ledger.json FINDINGS.md   the swarm's record, written by the solver process (never by the sandbox)
  logs/ grade.json run.json

Nothing the sandbox wrote is trusted as a record or followed as a link: a symbolic link, a hard
link, a device or a pipe under outputs/ fails the run (it scored 1.0 once, by pointing at the
grader's own files), and outputs/glhf/ledger.json is only the roles' working copy.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import platform
import re
import shutil
import stat
import time
from collections.abc import Callable, Iterator
from importlib.metadata import version
from pathlib import Path
from typing import Any

from inspect_ai import eval as inspect_eval
from inspect_ai.model import ChatMessage, GenerateConfig, Model, ModelOutput, get_model
from inspect_ai.tool import ToolChoice, ToolInfo

from bixbench3 import paid
from bixbench3.grading.grader import grade
from bixbench3.inspect_harness.models import RuntimeCase
from bixbench3.inspect_harness.swarm import relevance as swarm_relevance
from bixbench3.inspect_harness.swarm import roles as swarm_roles
from bixbench3.inspect_harness.swarm import tools as swarm_tools
from bixbench3.inspect_harness.swarm.baseline import TOKEN_SEMANTICS
from bixbench3.inspect_harness.swarm.ledger import UNREVIEWED
from bixbench3.inspect_harness.tasks import bixbench3_cases

LOCAL_COMPOSE = Path(__file__).parents[2] / "sandbox" / "local-compose.yaml"
MOCK = "mockllm/model"
ROLES = ("planner", "experimenter", "critic", "reporter")
GRADED_DIR = "graded"  # under --out; never mounted into the sandbox
UNTRUSTED = "sandbox-copy-untrusted"  # in graded/glhf/: ledger.<this>.json, FINDINGS.<this>.md
MAX_OUTPUT_FILE_BYTES = 2 * 1024**3
MAX_OUTPUT_TOTAL_BYTES = 8 * 1024**3
# The agent names of solver.py and the instructions that identify each in a model call.
ROLE_PROMPTS = {
    "scout": swarm_roles.SCOUT,
    "planner": swarm_roles.PLANNER,
    "pilot": swarm_roles.PILOT,
    "experimenter": swarm_roles.EXPERIMENTER,
    "auditor": swarm_roles.AUDITOR,
    "critic": swarm_roles.CRITIC,
    "reviser": swarm_roles.REVISER,
    "finisher": swarm_roles.FINISHER,
    "reporter": swarm_roles.REPORTER,
    "handoff": swarm_roles.HANDOFF,
    "relevance": swarm_relevance.INSTRUCTIONS,
}


def _call(tool: str, **arguments: object) -> ModelOutput:
    return ModelOutput.for_tool_call(MOCK, tool, arguments)


def _write(path: str, text: str) -> ModelOutput:
    return _call("python", code=f"open({path!r}, 'w').write({text!r})\nprint('wrote', {path!r})")


def _done(answer: str) -> ModelOutput:
    return _call("submit", answer=answer)


TESTS = "/workspace/work/glhf/tests"


def _test_script(name: str, body: str) -> ModelOutput:
    """The critic writes a falsification test as a script file (it is registered next)."""
    path = f"{TESTS}/{name}"
    return _call(
        "python",
        code=f"import os\nos.makedirs({TESTS!r}, exist_ok=True)\n"
        f"open({path!r}, 'w').write({body!r})\nprint('wrote', {path!r})",
    )


def role_script(
    truths: dict[str, str],
    review_rounds: int = 3,
    exa: bool = False,
    memory: bool = False,
    relevance_scores: tuple[float, float] = (1.0, 1.0),
) -> dict[str, list[ModelOutput]]:
    """The swarm's fixed script for `--model mock`, keyed by role. `truths` maps each required
    sandbox path to correct content.

    Each role plays its own lines, in order, whenever it is called (the auditor's and the
    critic's lists cover round 1, then round 2). A role that is skipped or cut off therefore
    cannot hand its lines to the next role, which is what a script kept by position did.

    Story: the first pass leaves the first artifact with a header and no rows; the critic
    raises that and registers a test script for the claim that the first pass was complete; the
    relevance judge passes the test and the harness runs it: it contradicts, the claim is
    refuted; the reviser fixes the artifact; in the second review the critic registers a test
    for the other claim, the judge passes it, the harness runs it and the claim is supported;
    the reporter writes METHODS.md. No role types a p-value. `relevance_scores` are the judge's
    scores in rounds 1 and 2 (a score under 0.8 in round 2 leaves the claim unsupported).
    """
    methods = _write(
        "/outputs/METHODS.md", "# Methods\n\nScripted mock run. No analysis was performed.\n"
    )
    correct = [_write(path, text) for path, text in truths.items()]
    search = [
        _call(
            "search_docs",
            query="featureCounts count reads per gene paired-end strandedness option",
            objective="Find the official featureCounts manual page; rank the Subread user guide "
            "first, exclude forum posts, and pull the meaning of the -s and -p options.",
        )
    ]
    lessons = [
        _write(
            "/workspace/work/glhf/lessons.md",
            "- Scripted run: check that every output has data rows, not just a header, "
            "before review.\n",
        )
    ]
    reporter = [methods, *(lessons if memory else []), _done("reported")]
    first_path, first_text = next(iter(truths.items()))
    header = first_text.splitlines()[0] + "\n"
    artifact = Path(first_path).stem
    if review_rounds == 0:
        # No review: the first pass leaves one artifact missing, so the finisher has to rescue it.
        # (A header with no rows is only a warning: it can be a correct, empty result.)
        return {
            "scout": [_done("inputs listed")],
            "planner": [_done("planned")],
            "pilot": [_done("pilot skipped in the scripted run")],
            # the first artifact is never written
            "experimenter": [*correct[1:], _done("first pass written")],
            "finisher": [correct[0], _done("rescued")],
            "reporter": reporter,
        }
    return {
        "scout": [
            _call("bash_session", action="type_submit", input="ls -la /data"),
            *(search if exa else []),
            _done("inputs listed"),
        ],
        "planner": [
            _call(
                "propose_claim",
                text="Every required output is derived from all listed samples.",
                artifact_ids=[artifact],
                null_hypothesis="At least one listed sample is missing from the outputs.",
            ),
            _call(
                "propose_claim",
                text="The first pass of the outputs is complete.",
                artifact_ids=[artifact],
                null_hypothesis="At least one output is incomplete after the first pass.",
            ),
            _done("planned"),
        ],
        "pilot": [_done("pilot skipped in the scripted run")],
        # first pass is wrong (header only)
        "experimenter": [
            _call("bash_session", action="type_submit", input="ls /data"),
            _write(first_path, header),
            *correct[1:],
            _done("first pass written"),
        ],
        "auditor": [_done("no undisclosed deviations"), _done("no undisclosed deviations")],
        "critic": [
            # round 1
            _call(
                "raise_issue",
                severity="blocking",
                artifact_ids=[artifact],
                problem=f"{Path(first_path).name} has a header and no rows.",
                evidence=f"wc -l {first_path} -> 1",
            ),
            _test_script(
                "row_count.py",
                "import csv\n"
                f"rows = list(csv.reader(open({first_path!r})))[1:]\n"
                "print('data rows:', len(rows))\n"
                "# No data row contradicts 'the first pass is complete'. Scripted values.\n"
                "print('GLHF_RESULT p_value=0.01 contradicts=true' if not rows else "
                "'GLHF_RESULT p_value=0.5 contradicts=false')\n",
            ),
            _call(
                "register_falsification_test",
                claim_id="C2",
                test_name="row count",
                method="Count data rows of the first output; none contradicts the claim.",
                script_path=f"{TESTS}/row_count.py",
                test_null="The first output has no data rows after the first pass.",
            ),
            _done("1 issue raised"),
            # round 2
            _test_script(
                "label_permutation.py",
                "# Scripted run: stands in for 10000 label permutations. No analysis is done.\n"
                "print('GLHF_RESULT p_value=0.0004 contradicts=false')\n",
            ),
            _call(
                "register_falsification_test",
                claim_id="C1",
                test_name="label permutation",
                method="Permute sample labels 10000 times; a p-value near 1 contradicts the claim.",
                script_path=f"{TESTS}/label_permutation.py",
                test_null="The outputs do not depend on which samples are used.",
            ),
            _done("no issues"),
        ],
        # The relevance judge: one answer per review round, a line per registered test.
        "relevance": [
            ModelOutput.from_content(MOCK, f"T1 score={score:g} reason=Scripted judgement.")
            for score in relevance_scores
        ],
        "reviser": [
            correct[0],
            _call(
                "resolve_issue",
                issue_id="I1",
                status="fixed",
                resolution="Reran the counting script; rows present.",
            ),
            _done("fixed"),
        ],
        "finisher": [*correct, _done("rescued")],  # plays only if an artifact is missing
        "reporter": reporter,
    }


CLAIMS_DIR = "/workspace/work/glhf/claims"


def _in_claim(claim_id: str, sandbox_path: str, pilot: bool = False) -> str:
    """Where a claim writes a required artifact: its folder, same relative path as under /outputs."""
    base = f"{CLAIMS_DIR}/{claim_id}/" + ("pilot/outputs" if pilot else "outputs")
    return base + sandbox_path.removeprefix("/outputs")


def _write_made(path: str, text: str) -> ModelOutput:
    return _call(
        "python",
        code=f"import os\nos.makedirs(os.path.dirname({path!r}), exist_ok=True)\n"
        f"open({path!r}, 'w').write({text!r})\nprint('wrote', {path!r})",
    )


def claims_role_script(truths: dict[str, str]) -> dict[str, list[ModelOutput]]:
    """The claims engine's fixed script for `--model mock`, keyed by role and claim ("pilot:C1"):
    each call plays the lines of its own role on its own claim, whatever order claims run in.

    Story: triage names C1 (high) and C2 (low). C2's pilot writes nothing, so code drops it dead on
    arrival. C1's pilot passes; its workup leaves the first artifact with a header and no rows; the
    critic raises a blocking issue, so code sends C1 back; the reviser fixes the artifact and
    resolves the issue; in round 2 the critic registers a test, the relevance judge passes it, the
    harness runs it and the ledger supports C1. Code copies C1's files to /outputs and the reporter
    writes METHODS.md. No role types a p-value or a verdict.
    """
    first_path, first_text = next(iter(truths.items()))
    artifact = Path(first_path).stem
    header = first_text.splitlines()[0] + "\n"
    claim = {
        "text": "Every required output is derived from all listed samples.",
        "artifact_ids": [artifact],
        "null_hypothesis": "At least one listed sample is missing from the outputs.",
    }
    weak = {
        "text": "A subset of samples is enough to reproduce the outputs.",
        "artifact_ids": [artifact],
        "null_hypothesis": "The outputs change when samples are left out.",
    }
    return {
        "planner": [
            _call("propose_claim", **claim, acuity="high"),
            _call("propose_claim", **weak, acuity="low"),
            _done("triaged"),
        ],
        "pilot:C1": [
            *(
                _write_made(_in_claim("C1", path, pilot=True), text)
                for path, text in truths.items()
            ),
            _call("claim_done", status="ok", note="pilot outputs shaped on a subsample"),
            _done("piloted"),
        ],
        # C2's pilot writes no file: the shape check fails and the claim is dead on arrival.
        "pilot:C2": [_call("claim_done", status="ok", note="nothing written"), _done("piloted")],
        "experimenter:C1": [
            _write_made(_in_claim("C1", first_path), header),
            *(_write_made(_in_claim("C1", path), text) for path, text in list(truths.items())[1:]),
            _call("claim_done", status="ok", note="first pass written"),
            _done("worked up"),
        ],
        "auditor:C1": [_done("no undisclosed deviations"), _done("no undisclosed deviations")],
        "critic:C1": [
            # round 1: the first artifact has a header and no rows
            _call(
                "raise_issue",
                severity="blocking",
                artifact_ids=[artifact],
                problem=f"{Path(first_path).name} has a header and no rows.",
                evidence=f"wc -l {_in_claim('C1', first_path)} -> 1",
            ),
            _done("1 issue raised"),
            # round 2
            _test_script(
                "label_permutation.py",
                "# Scripted run: stands in for 10000 label permutations. No analysis is done.\n"
                "print('GLHF_RESULT p_value=0.0004 contradicts=false')\n",
            ),
            _call(
                "register_falsification_test",
                claim_id="C1",
                test_name="label permutation",
                method="Permute sample labels 10000 times; a p-value near 1 contradicts the claim.",
                script_path=f"{TESTS}/label_permutation.py",
                test_null="The outputs do not depend on which samples are used.",
            ),
            _done("no issues"),
        ],
        "reviser:C1": [
            _write_made(_in_claim("C1", first_path), first_text),
            _call(
                "resolve_issue",
                issue_id="I1",
                status="fixed",
                resolution="Reran the counting script; rows present.",
            ),
            _call("claim_done", status="ok", note="rows restored"),
            _done("fixed"),
        ],
        "relevance": [ModelOutput.from_content(MOCK, "T1 score=1 reason=Scripted judgement.")],
        "reporter": [
            _write("/outputs/METHODS.md", "# Methods\n\nScripted mock run (claims engine).\n"),
            _done("reported"),
        ],
    }


_CLAIM_LINE = re.compile(r"GLHF claim: (C\d+) mode: (\w+)")


def claim_of(messages: list[ChatMessage]) -> str | None:
    """The claim a call works on, from the first line of its task (roles.claim_task)."""
    for message in messages:
        if message.role == "user":
            found = _CLAIM_LINE.search(message.text)
            if found:
                return found.group(1)
    return None


def by_claim_role(
    script: dict[str, list[ModelOutput]],
) -> Callable[[list[ChatMessage], list[ToolInfo], ToolChoice, GenerateConfig], ModelOutput]:
    """Like by_role, but a call on a claim plays the lines under "<role>:<claim>" when there are any."""
    plain = by_role(script)
    keyed = {name: list(lines) for name, lines in script.items() if ":" in name}

    def answer(
        messages: list[ChatMessage],
        tools: list[ToolInfo],
        tool_choice: ToolChoice,
        config: GenerateConfig,
    ) -> ModelOutput:
        claim = claim_of(messages)
        role = role_of(messages)
        key = f"{role}:{claim}"
        if claim and tools and key in keyed:
            if keyed[key]:
                return keyed[key].pop(0)
            return _done(f"scripted run: nothing left for {key}")
        return plain(messages, tools, tool_choice, config)

    return answer


def mock_script(
    solver: str,
    truths: dict[str, str],
    review_rounds: int = 3,
    exa: bool = False,
    memory: bool = False,
) -> list[ModelOutput]:
    """The single agent's fixed script. (For the swarm, the lines of `role_script` in the order
    of an undisturbed run; the run itself plays them by role, see `by_role`.)"""
    if solver == "single":
        return [
            *(_write(path, text) for path, text in truths.items()),
            _write(
                "/outputs/METHODS.md",
                "# Methods\n\nScripted mock run. No analysis was performed.\n",
            ),
            _done("done"),
        ]
    script = role_script(truths, review_rounds, exa, memory)
    return [output for lines in script.values() for output in lines]


def role_of(messages: list[ChatMessage]) -> str | None:
    """Which role a model call belongs to, from its system message (the role's instructions).
    Several instructions extend the experimenter's, so the longest one that is present wins."""
    system = "\n".join(m.text for m in messages if m.role == "system")
    found = [(len(text), name) for name, text in ROLE_PROMPTS.items() if text.strip() in system]
    return max(found)[1] if found else None


def by_role(
    script: dict[str, list[ModelOutput]],
) -> Callable[[list[ChatMessage], list[ToolInfo], ToolChoice, GenerateConfig], ModelOutput]:
    """A scripted model that answers each call with the next line of the calling role. A role
    with no line left submits; a hand-off turn (no tools) gets a one-line note."""
    left = {name: list(lines) for name, lines in script.items()}

    def answer(
        messages: list[ChatMessage],
        tools: list[ToolInfo],
        tool_choice: ToolChoice,
        config: GenerateConfig,
    ) -> ModelOutput:
        del tool_choice, config
        role = role_of(messages)
        if role == "relevance":
            if left.get("relevance"):
                return left["relevance"].pop(0)
            asked = sum(1 for m in messages if m.role == "user" for _ in m.text.split("=== T")[1:])
            return ModelOutput.from_content(
                MOCK,
                "\n".join(
                    f"T{n} score=1.0 reason=Scripted judgement." for n in range(1, asked + 1)
                ),
            )
        if role == "handoff" or not tools:
            return ModelOutput.from_content(MOCK, "Scripted run: no hand-off note.")
        lines = left.get(role or "", [])
        if lines:
            return lines.pop(0)
        return _done(f"scripted run: nothing left for {role or 'this role'}")

    return answer


@contextlib.contextmanager
def offline_search() -> Iterator[None]:
    """For the scripted run: search_docs works, and nothing can reach Exa.

    The scripted scout makes one search_docs call. It is answered here with an empty reply, and
    the runner's real key (if there is one) is taken out of the environment for the run, so a
    scripted run costs nothing even where a key is set. It called Exa once; never again."""
    real_search, real_key = swarm_tools.exa_docs, os.environ.get("EXA_API_KEY")

    async def canned(query: str, objective: str, api_key: str) -> dict[str, Any]:
        del query, objective, api_key
        return {"results": []}

    swarm_tools.exa_docs = canned
    os.environ["EXA_API_KEY"] = "scripted-run-no-key"
    try:
        yield
    finally:
        swarm_tools.exa_docs = real_search
        if real_key is None:
            os.environ.pop("EXA_API_KEY", None)
        else:
            os.environ["EXA_API_KEY"] = real_key


class UnsafeOutputs(RuntimeError):
    """The outputs folder holds something that is not a plain file. Nothing was graded."""


def _copy_regular_file(source: Path, target: Path, expected: os.stat_result, limit: int) -> int:
    """Copy one file that lstat said is regular. Opened without following a link, and checked
    again on the open descriptor, so what is copied is the file that was looked at."""
    descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_NONBLOCK", 0))
    copied = 0
    try:
        actual = os.fstat(descriptor)
        if not stat.S_ISREG(actual.st_mode) or (actual.st_dev, actual.st_ino) != (
            expected.st_dev,
            expected.st_ino,
        ):
            raise UnsafeOutputs("changed while it was being read")
        with os.fdopen(os.dup(descriptor), "rb") as reader, open(target, "xb") as writer:
            while chunk := reader.read(1024 * 1024):
                copied += len(chunk)
                if copied > limit:
                    raise UnsafeOutputs(f"larger than {limit} bytes")
                writer.write(chunk)
    finally:
        os.close(descriptor)
    return copied


def collect_outputs(
    outputs: Path,
    target: Path,
    *,
    max_file_bytes: int = MAX_OUTPUT_FILE_BYTES,
    max_total_bytes: int = MAX_OUTPUT_TOTAL_BYTES,
) -> list[dict[str, str]]:
    """Copy the regular files under `outputs` (which the sandbox could write) into `target`, a
    fresh folder the sandbox never saw, and return what was refused, as {path, reason}.

    Refused: symbolic links (to files or folders), files with more than one hard link, devices,
    pipes and sockets, files over `max_file_bytes`, and everything once `max_total_bytes` is
    reached. Nothing is followed and nothing outside `outputs` is read: every entry is examined
    with lstat and opened with O_NOFOLLOW."""
    if target.is_symlink() or target.exists():
        raise UnsafeOutputs(f"{target} already exists; it must be a fresh folder")
    refused: list[dict[str, str]] = []
    total = 0
    root = os.lstat(outputs)
    if not stat.S_ISDIR(root.st_mode):
        return [{"path": ".", "reason": "the outputs folder is not a folder (a link?)"}]
    target.mkdir(parents=True)
    pending = [Path()]
    while pending:
        folder = pending.pop()
        for name in sorted(os.listdir(outputs / folder)):
            relative = folder / name
            source = outputs / relative
            try:
                info = os.lstat(source)
                if stat.S_ISLNK(info.st_mode):
                    raise UnsafeOutputs("symbolic link")
                if stat.S_ISDIR(info.st_mode):
                    (target / relative).mkdir()
                    pending.append(relative)
                    continue
                if not stat.S_ISREG(info.st_mode):
                    raise UnsafeOutputs("not a regular file (device, pipe or socket)")
                if info.st_nlink > 1:
                    raise UnsafeOutputs(f"hard link ({info.st_nlink} names for one file)")
                if info.st_size > max_file_bytes:
                    raise UnsafeOutputs(f"larger than {max_file_bytes} bytes")
                if total + info.st_size > max_total_bytes:
                    raise UnsafeOutputs(f"the outputs exceed {max_total_bytes} bytes in total")
                total += _copy_regular_file(source, target / relative, info, max_file_bytes)
            except (UnsafeOutputs, OSError) as error:
                (target / relative).unlink(missing_ok=True)
                reason = str(error) if isinstance(error, UnsafeOutputs) else f"unreadable: {error}"
                refused.append({"path": str(relative), "reason": reason})
    return refused


def trusted_ledger(out_dir: Path, sample_store: dict[str, Any] | None) -> dict[str, Any] | None:
    """The swarm's ledger as the solver process kept it: from the sample's store, else from the
    host file the solver wrote during the run. Never from the sandbox's folders. Written to
    <out>/ledger.json and <out>/FINDINGS.md."""
    stored = sample_store or {}
    text = stored.get(swarm_tools.LEDGER_STORE_KEY)
    findings = stored.get(swarm_tools.FINDINGS_STORE_KEY)
    ledger_file = out_dir / swarm_tools.HOST_LEDGER_FILE
    if isinstance(text, str):
        swarm_tools.write_host_file(ledger_file, text)
        if isinstance(findings, str):
            swarm_tools.write_host_file(out_dir / swarm_tools.HOST_FINDINGS_FILE, findings)
    elif ledger_file.is_file() and not ledger_file.is_symlink():
        text = ledger_file.read_text(encoding="utf-8")
    else:
        return None
    loaded: dict[str, Any] = json.loads(text)
    return loaded


def load_case(case_dir: Path) -> RuntimeCase:
    first = (case_dir / "cases.jsonl").read_text(encoding="utf-8").splitlines()[0]
    return RuntimeCase.model_validate(json.loads(first))


def run_local(
    case_dir: Path,
    out_dir: Path,
    *,
    solver: str = "glhf",
    model: str = "mock",
    role_models: dict[str, str] | None = None,
    time_limit_seconds: int = 1800,
    review_rounds: int = 3,
    max_tokens: int | None = None,
    max_messages_per_role: int | None = None,
    exa: bool = False,
    memory_dir: Path | None = None,
    seed: int | None = None,
    mock_outputs: list[ModelOutput] | None = None,
    engine: str = "phases",
    no_critic: bool = False,
    no_auditor: bool = False,
    no_pilot: bool = False,
    no_retriage: bool = False,
    max_parallel: int = 2,
) -> dict[str, Any]:
    """`mock_outputs` replaces the fixed script of `--model mock` (tests only)."""
    # NO_PAID_CALLS (paid.py): before anything is created or started.
    paid.refuse_run(model, (role_models or {}).values(), exa=exa)
    case_dir, out_dir = case_dir.resolve(), out_dir.resolve()
    case = load_case(case_dir)
    workspace, outputs, data = out_dir / "workspace", out_dir / "outputs", case_dir / "data"
    for directory in (workspace, outputs):
        directory.mkdir(parents=True, exist_ok=True)
    data.mkdir(exist_ok=True)
    grading_spec = case_dir / "grader" / "artifacts_grading.json"
    # Only the case's data folder is mounted, never a folder that holds grader/. (Its host path
    # still shows in the sandbox's /proc/self/mountinfo, and grader/ is next to it: that is why
    # nothing the sandbox writes is followed as a link, see collect_outputs.)
    for mounted in (data, workspace, outputs):
        if grading_spec.parent.resolve().is_relative_to(mounted.resolve()):
            raise ValueError(f"{mounted} would put the grader's files inside the sandbox")
    graded = out_dir / GRADED_DIR
    for stale in (graded, out_dir / "artifact_grades"):
        if stale.is_symlink() or stale.is_file():
            stale.unlink()
        elif stale.exists():
            shutil.rmtree(stale)
    for name in (swarm_tools.HOST_LEDGER_FILE, swarm_tools.HOST_FINDINGS_FILE, "grade.json"):
        (out_dir / name).unlink(missing_ok=True)
    os.environ.update(
        BIXBENCH3_INSPECT_SANDBOX_COMPOSE=str(LOCAL_COMPOSE),
        BIXBENCH3_WORKSPACE_DIR=str(workspace),
        BIXBENCH3_OUTPUTS_DIR=str(outputs),
        BIXBENCH3_DATA_DIR=str(data),
    )
    # Where the solver process keeps the swarm's ledger during the run (swarm/tools.py).
    os.environ[swarm_tools.HOST_LEDGER_ENV] = str(out_dir)
    if model == "mock":
        if role_models:
            raise ValueError("role models cannot be combined with --model mock")
        truth_dir = grading_spec.parent
        spec = json.loads(grading_spec.read_text(encoding="utf-8"))
        truth_by_id = {
            a["artifact_id"]: (truth_dir / a["ground_truth"]["path"]).read_text()
            for a in spec["artifacts"]
        }
        truths = {o.sandbox_path: truth_by_id[o.artifact_id] for o in case.expected_outputs}
        scripted: Any = mock_outputs
        if scripted is None and solver == "glhf" and engine == "claims":
            scripted = by_claim_role(claims_role_script(truths))
        elif scripted is None and solver == "glhf":
            scripted = by_role(role_script(truths, review_rounds, exa, memory_dir is not None))
        resolved: Model = get_model(
            MOCK, custom_outputs=scripted if scripted is not None else mock_script(solver, truths)
        )
    else:
        resolved = get_model(model)

    started = time.time()
    swarm = solver == "glhf"
    settings: dict[str, Any] = {
        "solver": solver,
        "model": model,
        "role_models": role_models or {},
        "time_limit_seconds": time_limit_seconds,
        "max_tokens": max_tokens,
        "token_semantics": TOKEN_SEMANTICS[solver] if max_tokens else None,
        "max_messages_per_role": max_messages_per_role if swarm else None,
        "review_rounds": review_rounds if swarm else None,
        "engine": engine if swarm else None,
        "ablations": {
            "no_critic": no_critic,
            "no_auditor": no_auditor,
            "no_pilot": no_pilot,
            "no_retriage": no_retriage,
            "max_parallel": max_parallel,
        }
        if swarm and engine == "claims"
        else None,
        "exa": bool(exa and swarm),
        "memory": bool(memory_dir and swarm),
        "memory_source": None,  # filled in after the run: "file", "past.dev" or None
        "seed": seed,
        # What the swarm's roles have that the single agent does not. Disclose with scores.
        "swarm_only_tools": (
            ["check_outputs", "read_ledger", "ledger tools"]
            + (["search_docs"] if exa else [])
            + (["memory"] if memory_dir else [])
        )
        if swarm
        else [],
    }
    summary: dict[str, Any] = {
        "task": case.task_id,
        "solver": solver,
        "model": model,
        "role_models": role_models or {},
        "time_limit_seconds": time_limit_seconds,
        "limits": {"max_tokens": max_tokens, "max_messages_per_role": max_messages_per_role},
        "exa": exa,
        "memory_dir": str(memory_dir) if memory_dir else None,
        "seed": seed,
        "settings": settings,
        "versions": {"inspect_ai": version("inspect_ai"), "python": platform.python_version()},
        "started_at": started,
        "status": "running",
    }
    (out_dir / "run.json").write_text(json.dumps(summary, indent=2))
    task_args: dict[str, Any] = {"max_tokens": max_tokens, "seed": seed}
    if solver == "glhf":
        task_args |= {f"{role}_model": name for role, name in (role_models or {}).items()}
        task_args |= {
            "max_messages_per_role": max_messages_per_role,
            "exa": exa,
            "memory_dir": str(memory_dir.resolve()) if memory_dir else None,
            "engine": engine,
            "no_critic": no_critic,
            "no_auditor": no_auditor,
            "no_pilot": no_pilot,
            "no_retriage": no_retriage,
            "max_parallel": max_parallel,
        }
    # A scripted run never reaches a search engine, key or no key.
    with offline_search() if model == "mock" else contextlib.nullcontext():
        logs = inspect_eval(
            bixbench3_cases(
                dataset_path=str(case_dir),
                case_ids=[case.task_id],
                solver=solver,
                review_rounds=review_rounds,
                time_limit_seconds=time_limit_seconds,
                **task_args,
            ),
            model=resolved,
            log_dir=str(out_dir / "logs"),
            display="none",
        )
    log = logs[0]
    os.environ.pop(swarm_tools.HOST_LEDGER_ENV, None)
    sample = log.samples[0] if log.samples else None
    # The sandbox is gone. Its outputs are copied, plain files only, to a folder it never saw,
    # and the grader reads the copy: a link under outputs/ is never followed on the host.
    refused = collect_outputs(outputs, graded)
    result: dict[str, Any] | None = None
    unsafe: str | None = None
    if refused:
        shown = "; ".join(f"{r['path']} ({r['reason']})" for r in refused[:5])
        unsafe = (
            f"outputs rejected, nothing was graded: {len(refused)} entr"
            f"{'y is' if len(refused) == 1 else 'ies are'} not plain files: {shown}"
        )
        (out_dir / "grade.json").write_text(
            json.dumps({"score": None, "error": unsafe, "outputs_rejected": refused}, indent=2)
        )
    else:
        result = dict(grade(grading_spec, graded))
        (out_dir / "grade.json").write_text(json.dumps(result, indent=2, default=str))
    usage = {
        name: {
            "input_tokens": u.input_tokens,
            "output_tokens": u.output_tokens,
            "total_tokens": u.total_tokens,
        }
        for name, u in (log.stats.model_usage or {}).items()
    }
    ledger = trusted_ledger(out_dir, dict(sample.store) if sample else None) if swarm else None
    if ledger is not None:
        if refused:
            ledger.setdefault("events", []).append(
                {"kind": "outputs.rejected", "entries": refused[:50], "count": len(refused)}
            )
            swarm_tools.write_host_file(
                out_dir / swarm_tools.HOST_LEDGER_FILE, json.dumps(ledger, indent=2, default=str)
            )
        for event in ledger.get("events", []):
            if event.get("kind") == "settings":
                settings["memory_source"] = event.get("memory_source")
            if event.get("kind") == UNREVIEWED:
                summary["unreviewed"] = True  # shown with the score: no critic pass finished
        summary["ledger"] = swarm_tools.HOST_LEDGER_FILE
        summary["findings"] = swarm_tools.HOST_FINDINGS_FILE
        summary["claims"] = [
            {key: claim.get(key) for key in ("id", "text", "verdict", "e_value", "threshold")}
            for claim in ledger.get("claims", [])
        ]
        # The roles' working copy, for comparison only. A difference means a role rewrote it.
        copy = graded / "glhf" / "ledger.json"
        if not refused and copy.is_file():
            try:
                same = json.loads(copy.read_text(encoding="utf-8")).get("claims") == ledger.get(
                    "claims"
                )
            except (ValueError, AttributeError):
                same = False
            summary["sandbox_ledger_differs"] = not same
        # In the copy, the sandbox's versions carry a name that says what they are.
        for name in ("ledger.json", "FINDINGS.md"):
            sandbox_copy = graded / "glhf" / name
            if sandbox_copy.is_file() and not sandbox_copy.is_symlink():
                stem, _, suffix = name.rpartition(".")
                sandbox_copy.rename(sandbox_copy.with_name(f"{stem}.{UNTRUSTED}.{suffix}"))
    if sample is not None and "token_budget" in (sample.metadata or {}):
        settings["token_budget"] = sample.metadata["token_budget"]
    summary.update(
        status="done" if log.status == "success" and not refused else "failed",
        error=unsafe if refused else (str(log.error.message) if log.error else None),
        outputs_rejected=refused,
        graded_outputs=GRADED_DIR,
        finished_at=time.time(),
        seconds=round(time.time() - started, 1),
        score=result["score"] if result else None,
        artifacts=[
            {"artifact_id": a["artifact_id"], "score": a["score"]} for a in result["artifacts"]
        ]
        if result
        else [],
        usage=usage,
        messages=len(log.samples[0].messages) if log.samples else 0,
    )
    (out_dir / "run.json").write_text(json.dumps(summary, indent=2))
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--case",
        type=Path,
        required=True,
        help="case directory (cases.jsonl, prompt.md, data/, grader/)",
    )
    parser.add_argument("--out", type=Path, required=True, help="run directory to create")
    parser.add_argument("--solver", choices=("single", "glhf"), default="glhf")
    parser.add_argument("--model", default="mock", help="'mock' or an Inspect provider/model id")
    parser.add_argument("--role-model", action="append", default=[], metavar="ROLE=MODEL")
    parser.add_argument("--time-limit", type=int, default=1800, help="seconds for the whole run")
    parser.add_argument("--review-rounds", type=int, default=3)
    parser.add_argument("--max-tokens", type=int, help="token budget for the whole run")
    parser.add_argument(
        "--max-messages-per-role",
        type=int,
        help="swarm: message cap per phase (a model call with one tool call is two messages)",
    )
    parser.add_argument(
        "--exa", action="store_true", help="swarm: documentation search (needs EXA_API_KEY)"
    )
    parser.add_argument("--memory-dir", type=Path, help="swarm: keep lessons between runs here")
    parser.add_argument("--seed", type=int, help="sent to providers that support a seed")
    parser.add_argument(
        "--engine",
        choices=("phases", "claims"),
        default="phases",
        help="swarm: nine phases in order (default), or the claims engine",
    )
    for name, what in (
        ("critic", "the critic"),
        ("auditor", "the methods auditor"),
        ("pilot", "the pilot"),
        ("retriage", "moving unspent budget between claims"),
    ):
        parser.add_argument(f"--no-{name}", action="store_true", help=f"claims engine: no {what}")
    parser.add_argument(
        "--max-parallel", type=int, default=2, help="claims engine: claims worked on at once"
    )
    arguments = parser.parse_args()
    role_models: dict[str, str] = {}
    for item in arguments.role_model:
        role, sep, name = item.partition("=")
        if not sep or role not in ROLES:
            parser.error(f"--role-model expects ROLE=MODEL with ROLE in {ROLES}; got {item!r}")
        role_models[role] = name
    try:  # NO_PAID_CALLS (paid.py): a refusal is one line, not a traceback
        paid.refuse_run(arguments.model, role_models.values(), exa=arguments.exa)
    except paid.PaidCallsOff as error:
        parser.error(str(error))
    summary = run_local(
        arguments.case,
        arguments.out,
        solver=arguments.solver,
        model=arguments.model,
        role_models=role_models,
        time_limit_seconds=arguments.time_limit,
        review_rounds=arguments.review_rounds,
        max_tokens=arguments.max_tokens,
        max_messages_per_role=arguments.max_messages_per_role,
        exa=arguments.exa,
        memory_dir=arguments.memory_dir,
        seed=arguments.seed,
        engine=arguments.engine,
        no_critic=arguments.no_critic,
        no_auditor=arguments.no_auditor,
        no_pilot=arguments.no_pilot,
        no_retriage=arguments.no_retriage,
        max_parallel=arguments.max_parallel,
    )
    print(json.dumps(summary, indent=2))
    return 0 if summary["status"] == "done" else 1


if __name__ == "__main__":
    raise SystemExit(main())
