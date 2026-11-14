"""End to end in a real Docker sandbox with a scripted model: both solvers on the synthetic
capsule, the blind critic, reconciliation, grading on the host, and the integrity boundary as
the container actually enforces it. No paid call is made. Skipped when Docker is not running.

The image is python:3.12-slim (small); the official BixBench image is used for real runs.
"""

from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path

import pytest
from conftest import SENTINELS, UUID, Synthetic, docker_running
from inspect_ai.log import read_eval_log
from inspect_ai.model import ModelOutput, ModelUsage

from bixbench_v1 import cli, staging
from bixbench_v1.runner import MOCK, grade_run, run_capsule

pytestmark = pytest.mark.skipif(not docker_running(), reason="Docker is not running")
IMAGE = "python:3.12-slim"


def call(tool: str, **arguments: object) -> ModelOutput:
    return ModelOutput.for_tool_call(MOCK, tool, arguments)


def shell(command: str) -> ModelOutput:
    return call("bash_session", action="type_submit", input=command)


def answer(question: int, value: str, route: str = "pandas on counts.csv") -> ModelOutput:
    return call(
        "submit_answer",
        question_id=f"syn-1-q{question}",
        answer=value,
        route=route,
        evidence="work/s.py",
    )


DONE = call("submit", answer="done")
PROBE = (
    "import os, socket, subprocess\n"
    "print('WHOAMI', subprocess.run(['id', '-un'], capture_output=True, text=True).stdout.strip())\n"
    "for path in ('/home/deriv_a/work/notes.txt', '/home/deriv_a', '/root', '/tmp/scratch_a.txt'):\n"
    "    try:\n"
    "        os.listdir(path) if os.path.isdir(path) else open(path).read()\n"
    "        print('READABLE', path)\n"
    "    except OSError as error:\n"
    "        print('DENIED', path, type(error).__name__)\n"
    "try:\n"
    "    socket.create_connection(('1.1.1.1', 53), timeout=3)\n"
    "    print('NETWORK up')\n"
    "except OSError as error:\n"
    "    print('NETWORK down', type(error).__name__)\n"
    "try:\n"
    "    open('/data/new.txt', 'w')\n"
    "    print('DATA writable')\n"
    "except OSError as error:\n"
    "    print('DATA read-only', type(error).__name__)\n"
    "found = []\n"
    "for root in ('/data', '/outputs', '/home/deriv_b', '/tmp'):\n"
    "    for folder, _, files in os.walk(root):\n"
    "        for name in files:\n"
    "            path = os.path.join(folder, name)\n"
    "            try:\n"
    "                text = open(path, errors='ignore').read()\n"
    "            except OSError:\n"
    "                continue\n"
    "            if 'SENTINEL' in text or name.endswith('.ipynb'):\n"
    "                found.append(path)\n"
    "print('SECRETS', found)\n"
    "print('DATA', sorted(os.listdir('/data')), 'ENV', sorted(k for k in os.environ if 'API' in k or 'TOKEN' in k))\n"
)

SWARM_SCRIPT = [
    # analyst: leaves a note in its home and a file in shared /tmp, answers all three
    shell("echo 'sum is four' > ~/work/notes.txt; echo scratch > /tmp/scratch_a.txt; id -un"),
    answer(1, "5", route="summed column a"),  # wrong on purpose
    answer(2, "3.0"),
    answer(3, "two genes, two samples"),
    DONE,
    # critic: probes the boundary, then answers independently
    call("python", code=PROBE),
    answer(1, "4", route="awk over the csv"),
    answer(2, "3"),
    answer(3, "a small count table"),
    DONE,
    # reconciler: resolves the numeric mismatch and the free-text pair
    shell("cat /home/deriv_a/work/notes.txt; id -un"),
    call(
        "resolve_dispute",
        question_id="syn-1-q1",
        keep="B",
        final_answer="4",
        cause="A added the header row index",
        evidence="reconcile/check.py: 1 + 3 = 4",
    ),
    call(
        "resolve_dispute",
        question_id="syn-1-q3",
        keep="both",
        final_answer="a small count table",
        cause="same description in different words",
        evidence="read both",
    ),
    DONE,
]


class RecordingJudge:
    def __init__(self) -> None:
        self.prompts: list[str] = []

    async def __call__(self, prompt: str) -> str:
        self.prompts.append(prompt)
        return "<grade> incorrect </grade>"


def run(
    synthetic: Synthetic, out: Path, solver: str, script: list[ModelOutput], **kw: object
) -> dict:
    return run_capsule(
        synthetic.capsule,
        hub_dir=synthetic.hub,
        staged_root=synthetic.staged,
        out_dir=out,
        solver=solver,
        model="mock",
        time_limit_seconds=300,
        image=IMAGE,
        mock_outputs=script,
        **kw,  # type: ignore[arg-type]
    )


def test_swarm_blind_critic_reconciliation_and_boundary(
    synthetic: Synthetic, tmp_path: Path
) -> None:
    out = tmp_path / "run"
    summary = run(synthetic, out, "glhf", SWARM_SCRIPT, max_tokens=500_000)
    assert summary["status"] == "done", summary["error"]
    assert summary["answer_statuses"] == {
        "syn-1-q1": "reconciled",
        "syn-1-q2": "replicated",
        "syn-1-q3": "reconciled",
    }
    assert [p["phase"] for p in summary["phases"] if p["kind"] == "phase.started"] == [
        "analyst",
        "critic",
        "reconciler",
    ]
    settings = summary["settings"]
    assert settings["network"] == "none" and settings["image"] == IMAGE
    assert settings["documentation_search"] is False and settings["lessons_memory"] is False
    assert settings["max_tokens"] == 500_000 and settings["time_limit_seconds"] == 300

    log = read_eval_log(str(next((out / "logs").glob("*.eval"))))
    assert log.samples is not None
    transcript = "\n".join(str(m.content) for m in log.samples[0].messages)
    # The critic ran as its own user and could not read the analyst's files, home or scratch.
    assert "WHOAMI deriv_b" in transcript
    for path in ("/home/deriv_a/work/notes.txt", "/home/deriv_a", "/root", "/tmp/scratch_a.txt"):
        assert f"DENIED {path}" in transcript
    assert "READABLE" not in transcript
    # No network, read-only data, only input files, no secrets and no keys in the container.
    assert "NETWORK down" in transcript and "DATA read-only" in transcript
    assert "SECRETS []" in transcript
    assert "DATA ['counts.csv', 'nested', 'results.busco.zip'] ENV []" in transcript
    # The critic's task named the first route but not the first answer; the reconciler, as
    # root, could read the analyst's note.
    critic_task = next(
        str(m.content)
        for m in log.samples[0].messages
        if "Route of the first derivation" in str(m.content)
    )
    assert "syn-1-q1: summed column a" in critic_task and "two genes" not in critic_task
    assert "sum is four\nroot" in transcript.replace("\r", "")
    # Nothing secret reached Inspect: not the sample, not the transcript, not the log file.
    raw_log = _eval_text(next((out / "logs").glob("*.eval")))
    for name, secret in SENTINELS.items():
        assert secret not in transcript and secret not in raw_log, name

    outputs = out / "outputs"
    answers = json.loads((outputs / "answers.json").read_text())
    assert answers["answers"]["syn-1-q1"]["answer"] == "4"
    assert [r["answer"] for r in answers["rejected"]] == ["5"]
    findings = (outputs / "glhf" / "FINDINGS.md").read_text()
    assert "Rejected derivations (1)" in findings and "A added the header row index" in findings
    assert "## syn-1-q1" not in findings and (outputs / "METHODS.md").exists()
    assert (outputs / "glhf" / "ledger.json").exists()

    judge = RecordingJudge()
    graded = grade_run(out, synthetic.capsule, judge, "fake", ("per-mode", "official"))
    grades = {g["question_id"]: g for g in graded["profiles"]["per-mode"]["grades"]}
    assert (grades["syn-1-q1"]["correct"], grades["syn-1-q1"]["method"]) == (True, "exact")
    assert (grades["syn-1-q2"]["correct"], grades["syn-1-q2"]["method"]) == (True, "range")
    assert (grades["syn-1-q3"]["correct"], grades["syn-1-q3"]["method"]) == (False, "llm")
    assert graded["profiles"]["per-mode"]["summary"]["correct"] == 2
    # The judge saw question, ideal and answer only: no route, evidence or transcript.
    assert all("awk over the csv" not in p and "work/s.py" not in p for p in judge.prompts)
    # grade.json records verdicts, not the key.
    assert SENTINELS["ideal"] not in (out / "grade.json").read_text()


def _eval_text(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        return "\n".join(
            archive.read(name).decode("utf-8", "ignore") for name in archive.namelist()
        )


def test_fully_blind_critic_gets_no_route(synthetic: Synthetic, tmp_path: Path) -> None:
    script = [answer(1, "4", route="summed column a"), DONE, answer(1, "4"), DONE]
    summary = run(synthetic, tmp_path / "run", "glhf", script, critic_hints="none")
    assert summary["status"] == "done", summary["error"]
    assert summary["settings"]["critic_hints"] == "none"
    assert summary["answer_statuses"]["syn-1-q1"] == "replicated"
    log = read_eval_log(str(next((tmp_path / "run" / "logs").glob("*.eval"))))
    assert log.samples is not None
    transcript = "\n".join(str(m.content) for m in log.samples[0].messages)
    assert "Derive every answer independently." in transcript
    assert "Route of the first derivation" not in transcript
    # No mismatch, so the reconciler never ran.
    assert [p["phase"] for p in summary["phases"] if p["kind"] == "phase.started"] == [
        "analyst",
        "critic",
    ]


def test_single_agent_on_the_same_capsule(synthetic: Synthetic, tmp_path: Path) -> None:
    script = [shell("ls /data; id -un"), answer(1, "4"), answer(2, "7"), DONE]
    summary = run(synthetic, tmp_path / "run", "single", script, max_tokens=500_000)
    assert summary["status"] == "done", summary["error"]
    assert summary["answer_statuses"] == {
        "syn-1-q1": "unchecked",
        "syn-1-q2": "unchecked",
        "syn-1-q3": "missing",
    }
    assert summary["settings"]["tools"] == [
        "bash_session",
        "python",
        "text_editor",
        "submit_answer",
    ]
    graded = grade_run(tmp_path / "run", synthetic.capsule, None)
    rows = {g["question_id"]: g for g in graded["profiles"]["per-mode"]["grades"]}
    assert rows["syn-1-q1"]["correct"] and not rows["syn-1-q2"]["correct"]
    assert rows["syn-1-q3"]["method"] == "empty" and not rows["syn-1-q3"]["correct"]
    assert not list((tmp_path / "run" / "outputs" / "glhf" / "work" / "deriv_b").rglob("*"))


def test_answers_recorded_before_the_token_budget_ends_still_count(
    synthetic: Synthetic, tmp_path: Path
) -> None:
    script = [answer(1, "4"), answer(2, "3"), answer(3, "x"), DONE]
    for output in script:  # every model call costs 1,000 tokens
        output.usage = ModelUsage(input_tokens=900, output_tokens=100, total_tokens=1000)
    summary = run(synthetic, tmp_path / "run", "single", script, max_tokens=2500)
    assert summary["status"] == "done", summary["error"]
    finished = [p for p in summary["phases"] if p["kind"] == "phase.finished"]
    assert [p["limit"] for p in finished] == ["token"] and finished[0]["tokens"] == 3000
    # Limits are checked after each call: the third call went over, so its answer never ran.
    assert summary["answer_statuses"] == {
        "syn-1-q1": "unchecked",
        "syn-1-q2": "unchecked",
        "syn-1-q3": "missing",
    }
    assert summary["total_tokens"] == 3000
    assert (tmp_path / "run" / "outputs" / "METHODS.md").exists()


def test_a_tampered_staging_stops_the_run_before_any_container(
    synthetic: Synthetic, tmp_path: Path
) -> None:
    data = staging.stage_capsule(synthetic.zip_path, synthetic.staged / UUID)
    (data / "solution.ipynb").write_text("{}")
    with pytest.raises(staging.IntegrityError):
        run(synthetic, tmp_path / "run", "single", [DONE])
    assert not (tmp_path / "run" / "run.json").exists()


def test_grading_refuses_an_unfinished_run(synthetic: Synthetic, tmp_path: Path) -> None:
    out = tmp_path / "run"
    out.mkdir()
    (out / "run.json").write_text(json.dumps({"status": "running"}))
    with pytest.raises(RuntimeError, match="not finished"):
        grade_run(out, synthetic.capsule, None)


def test_cli_runs_both_solvers_with_the_scripted_model_and_respects_the_cap(
    synthetic: Synthetic,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    data = synthetic.hub.parent
    out = tmp_path / "set"
    base = ["bixbench-v1", "--data", str(data), "run", "--capsules", "syn-1", "--model", "mock"]
    base += ["--image", IMAGE, "--out", str(out), "--time-limit", "300", "--max-tokens", "400000"]
    # A run starts only if the cap covers its worst case (1.25 x budget + the judge reserve =
    # 520,000). The first run fits exactly; after it has spent anything, the second does not.
    monkeypatch.setattr(sys, "argv", [*base, "--total-token-cap", "520000"])
    assert cli.main() == 2
    printed = capsys.readouterr().out
    assert "STOP before" in printed and "Scripted mock model" in printed
    budget = json.loads((out / "budget.json").read_text())
    assert [r["run"] for r in budget["runs"]] == ["syn-1_11111111/single"]
    assert 0 < budget["spent"] <= 520_000
    # Without the cap the remaining run is done; the finished one is skipped, not repeated.
    monkeypatch.setattr(sys, "argv", base)
    assert cli.main() == 0
    printed = capsys.readouterr().out
    assert "skip" in printed
    report = json.loads((out / "report.json").read_text())
    assert set(report["solvers"]) == {"single", "glhf"} and report["scripted_model"] is True
    assert report["paired"]["n"] == 3
    assert report["solvers"]["glhf"]["by_status"]["reconciled"]["n"] == 1
    assert SENTINELS["ideal"] not in (out / "report.json").read_text()
    assert "| syn-1_11111111 | syn-1-q1 | str_verifier |" in (out / "report.md").read_text()
