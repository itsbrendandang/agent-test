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


def sanswer(question: int, value: str, method: str, route: str = "pandas") -> ModelOutput:
    """A swarm derivation's answer: the same record plus its one-line method."""
    return call(
        "submit_answer",
        question_id=f"syn-1-q{question}",
        answer=value,
        method=method,
        route=route,
        evidence="work/s.py",
    )


def rederive(question: int, script: str, value: str, cause: str, **more: object) -> ModelOutput:
    return call(
        "rederive",
        question_id=f"syn-1-q{question}",
        script=script,
        answer=value,
        cause=cause,
        same_method=bool(more.pop("same_method", False)),
        **more,
    )


def write(path: str, text: str) -> ModelOutput:
    return shell(f"cat > {path} <<'EOS'\n{text}\nEOS")


PANDAS = "data=counts.csv column a; subset=all rows; procedure=sum of the column; tool=pandas.sum"
AWK = (
    "data=counts.csv second field; subset=lines after the header; procedure=running total; tool=awk"
)
SUM_A = "print(sum(int(l.split(',')[1]) for l in open('/data/counts.csv').read().split()[1:]))"
ANALYST_FILES = (
    "notes.txt", "scratch_a.txt", "answer_is_five.txt", "shm_a.txt", "a_dir", "inner.txt", "leak_a.txt",
)  # fmt: skip
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
    f"names = {set(ANALYST_FILES)!r}\n"
    "seen = []\n"
    "for folder, dirs, files in os.walk('/'):\n"
    "    dirs[:] = [d for d in dirs if os.path.join(folder, d) not in ('/proc', '/sys', '/data')]\n"
    "    seen += [os.path.join(folder, n) for n in dirs + files if n in names]\n"
    "print('ANALYST_PATHS', seen)\n"
    "print('OUTPUTS', os.listdir('/outputs'), 'WORK', os.listdir(os.path.expanduser('~/work')))\n"
    "print('DATA', sorted(os.listdir('/data')), 'ENV', sorted(k for k in os.environ if 'API' in k or 'TOKEN' in k))\n"
)

SWARM_SCRIPT = [
    # analyst: answers all three, and leaves traces everywhere its user can write: its home
    # (which it then opens to everyone), three shared scratch directories with a file name
    # that carries its answer, and the mounted /outputs.
    shell(
        "echo 'sum is four' > ~/work/notes.txt; echo scratch > /tmp/scratch_a.txt; "
        "echo x > /var/tmp/answer_is_five.txt; echo x > /dev/shm/shm_a.txt; "
        "mkdir /tmp/a_dir; echo x > /tmp/a_dir/inner.txt; echo five > /outputs/leak_a.txt; "
        "chmod -R a+rX ~ /tmp/a_dir; chmod a+r /tmp/scratch_a.txt; id -un"
    ),
    sanswer(1, "5", PANDAS, route="summed column a"),  # wrong on purpose
    sanswer(
        2, "3.0", "data=counts.csv column b; subset=all rows; procedure=mean; tool=pandas.mean"
    ),
    sanswer(
        3,
        "two genes, two samples",
        "data=counts.csv; subset=header and rows; procedure=read it; tool=head",
    ),
    DONE,
    # critic: probes the boundary, then answers independently
    call("python", code=PROBE),
    sanswer(1, "4", AWK, route="awk over the csv"),
    sanswer(
        2,
        "3",
        "data=counts.csv third field; subset=two data lines; procedure=average by hand; tool=awk",
    ),
    sanswer(
        3,
        "a small count table",
        "data=counts.csv; subset=whole file; procedure=describe shape; tool=wc",
    ),
    DONE,
    # reconciler: as root it can read the analyst's note; it re-derives the numeric mismatch
    # and the free-text pair with scripts the harness runs itself
    shell("cat /home/deriv_a/work/notes.txt; id -un"),
    write("/root/reconcile/q1.py", SUM_A),
    rederive(1, "/root/reconcile/q1.py", "4", "A added the header row index"),
    write(
        "/root/reconcile/q3.sh", "head -n 1 /data/counts.csv > /dev/null\necho a small count table"
    ),
    rederive(
        3,
        "/root/reconcile/q3.sh",
        "a small count table",
        "same description in different words",
        text_matches="both",
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
    assert "READABLE /" not in transcript  # (the probe's own code is quoted to the reconciler)
    # No network, read-only data, only input files, no secrets and no keys in the container.
    assert "NETWORK down" in transcript and "DATA read-only" in transcript
    assert "SECRETS []" in transcript
    assert "DATA ['counts.csv', 'nested', 'results.busco.zip'] ENV []" in transcript
    # The critic can find no path the analyst wrote, anywhere: not in shared scratch (a file
    # name alone can carry an answer), not in /outputs; and it starts in an empty directory.
    assert "ANALYST_PATHS []" in transcript and "OUTPUTS [] WORK []" in transcript
    assert summary["blind_check"] == {"checked": True, "visible_to_critic": []}
    # The critic's task holds the questions and nothing the analyst produced: no route (as it
    # did before), no method, no answer, no path. The reconciler, as root, can read the note.
    messages = [str(m.content) for m in log.samples[0].messages]
    critic_task = messages[messages.index(next(m for m in messages if "phase: critic" in m)) + 1]
    assert "What is the sum of column a" in critic_task
    for leak in (
        "summed column a",
        PANDAS,
        "two genes",
        "notes.txt",
        "deriv_a",
        "first derivation",
    ):
        assert leak not in critic_task, leak
    assert "sum is four\nroot" in transcript.replace("\r", "")
    # Unused budget rolled forward: the critic may spend all the analyst left but the
    # reconciler's floor (3 questions: 60,000), not a fixed 42%.
    started = {p["phase"]: p for p in summary["phases"] if p["kind"] == "phase.started"}
    finished = {p["phase"]: p for p in summary["phases"] if p["kind"] == "phase.finished"}
    assert started["analyst"]["tokens_allowed"] == 500_000 - 155_000 - 60_000
    assert started["critic"]["tokens_allowed"] == 500_000 - finished["analyst"]["tokens"] - 60_000
    assert started["critic"]["tokens_allowed"] > started["analyst"]["tokens_allowed"]
    assert summary["budget"]["reading"] == "same budget"
    assert summary["settings"]["swarm_budget"]["mode"] == "equal"
    assert summary["settings"]["total_budget_tokens"] == summary["settings"]["single_budget_tokens"]
    # Per question: both answers, agreed?, same method?, the reconciler's value, changed?
    rows = {r["question_id"]: r for r in summary["questions"]}
    q1, q2 = rows["syn-1-q1"], rows["syn-1-q2"]
    assert (q1["analyst_answer"], q1["critic_answer"], q1["agreed"]) == ("5", "4", False)
    assert (q1["reconciler_answer"], q1["reconciler_changed"], q1["final_answer"]) == (
        "4",
        True,
        "4",
    )
    assert q1["same_method"] is False and q1["reconciler_printed"] == "4"
    assert (q2["agreed"], q2["same_method"], q2["reconciler_answer"]) == (True, False, None)
    assert q2["reconciler_changed"] is False
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
    assert all(AWK not in p and "q1.py" not in p for p in judge.prompts)
    # grade.json records verdicts, not the key.
    assert SENTINELS["ideal"] not in (out / "grade.json").read_text()


def _eval_text(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        return "\n".join(
            archive.read(name).decode("utf-8", "ignore") for name in archive.namelist()
        )


@pytest.mark.parametrize("hints", ["none", "route"])
def test_fully_blind_critic_gets_no_route(synthetic: Synthetic, tmp_path: Path, hints: str) -> None:
    # "route" is what the command line still passes by default; it is ignored.
    script = [
        sanswer(1, "4", PANDAS, route="summed column a"),
        DONE,
        sanswer(1, "4", AWK),
        DONE,
        DONE,
    ]
    summary = run(
        synthetic, tmp_path / "run", "glhf", script, critic_hints=hints, question_ids=["syn-1-q1"]
    )
    assert summary["status"] == "done", summary["error"]
    assert summary["settings"]["critic_hints"] == "none"
    assert summary["answer_statuses"]["syn-1-q1"] == "replicated"
    log = read_eval_log(str(next((tmp_path / "run" / "logs").glob("*.eval"))))
    assert log.samples is not None
    transcript = "\n".join(str(m.content) for m in log.samples[0].messages)
    assert "Answer every question from the data in /data." in transcript
    assert "Route of the first derivation" not in transcript
    assert (
        "summed column a" not in transcript
        and PANDAS not in transcript.split("phase: critic")[1].split("phase: reconciler")[0]
    )
    # An agreement by different methods: the reconciler is asked, and may leave it.
    assert [p["phase"] for p in summary["phases"] if p["kind"] == "phase.started"] == [
        "analyst",
        "critic",
        "reconciler",
    ]
    assert summary["questions"][0]["reconciler_action"] is None


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
