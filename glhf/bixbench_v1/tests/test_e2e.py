"""End to end in a real Docker sandbox with a scripted model: both solvers on the synthetic
capsule, the blind critic, reconciliation, grading on the host, and the integrity boundary as
the container actually enforces it. No paid call is made. Skipped when Docker is not running.

The image is python:3.12-slim (small); the official BixBench image is used for real runs.
"""

from __future__ import annotations

import json
import os
import sys
import zipfile
from pathlib import Path

import pytest
from conftest import SENTINELS, UUID, Synthetic, docker_running
from inspect_ai.log import read_eval_log
from inspect_ai.model import ModelOutput, ModelUsage

from bixbench_v1 import cli, runner, staging
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
SERVER = (
    "import socket\n"
    "s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)\n"
    "s.bind(('127.0.0.1', 8124)); s.listen(5)\n"
    "while True:\n"
    "    c, _ = s.accept(); c.sendall(b'A-ANSWER q1 is five'); c.close()\n"
)
# What a non-compliant analyst leaves behind that is not a file its user owns on a swept
# filesystem: a server renamed to look like Inspect's tool process, a queue on the separate
# /dev/mqueue mount, and world-readable System V shared memory and message queue.
ATTACK_SHELL = (
    "cd / && (setsid nohup bash -c 'exec -a inspect-sandbox-tools python3 /home/deriv_a/tmp/srv.py' "
    ">/dev/null 2>&1 &) ; sleep 2; "
    "touch /dev/mqueue/A-ANSWER_q1_is_five && chmod 666 /dev/mqueue/A-ANSWER_q1_is_five; "
    "ipcmk -M 4096 -p 0666; ipcmk -Q -p 0666; "
    "echo ATTACK mqueue $(ls /dev/mqueue); "
    "echo ATTACK sysv $(($(cat /proc/sysvipc/shm /proc/sysvipc/msg | wc -l) - 2))"
)
ATTACK = call(
    "python",
    code=(
        "import socket, subprocess\n"
        f"open('/home/deriv_a/tmp/srv.py', 'w').write({SERVER!r})\n"
        f"print(subprocess.run(['bash', '-c', {ATTACK_SHELL!r}], capture_output=True, text=True).stdout)\n"
        "print('ATTACK server says', socket.create_connection(('127.0.0.1', 8124), timeout=5).recv(100))\n"
    ),
)
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
    # The three channels the red-team used past the file sweep: a process of the analyst's
    # serving on loopback under Inspect's own process name, a POSIX message queue, SysV IPC.
    "try:\n"
    "    print('LOOPBACK open', socket.create_connection(('127.0.0.1', 8124), timeout=3).recv(100))\n"
    "except OSError as error:\n"
    "    print('LOOPBACK closed', type(error).__name__)\n"
    "print('MQUEUE', os.listdir('/dev/mqueue'))\n"
    "print('SYSV', sum(len(open('/proc/sysvipc/' + k).read().splitlines()) - 1 for k in ('shm', 'msg', 'sem')))\n"
    "print('MOUNTS', [l.split()[3] for l in open('/proc/self/mountinfo') if l.split()[4] in ('/data', '/outputs')], 'ENDMOUNTS')\n"
    "print('MOUNTINFO', open('/proc/self/mountinfo').read(), 'ENDMOUNTINFO')\n"
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
    ATTACK,
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
    # The analyst's attack worked while it ran (so the checks below mean something)...
    assert "ATTACK server says b'A-ANSWER q1 is five'" in transcript
    assert "ATTACK mqueue A-ANSWER_q1_is_five" in transcript and "ATTACK sysv 2" in transcript
    # ...and none of it is there for the critic: the disguised server was killed (by uid, not
    # by name), the message queue and the System V objects are gone.
    assert "LOOPBACK closed ConnectionRefusedError" in transcript
    assert "MQUEUE []" in transcript and "SYSV 0" in transcript
    # The host paths behind /data and /outputs (readable in /proc/self/mountinfo) are neutral:
    # no capsule uuid, no run folder, and nothing that names the solver or the model.
    mountinfo = transcript.split("MOUNTINFO", 1)[1].split("ENDMOUNTINFO", 1)[0]
    assert "/data" in mountinfo and "/outputs" in mountinfo
    assert UUID not in mountinfo and "CapsuleData" not in mountinfo
    assert f"{out.name}/outputs" not in mountinfo and "glhf" not in mountinfo
    assert "/mounts/" in transcript.split("MOUNTS", 1)[1].split("ENDMOUNTS", 1)[0]
    # The run wrote into the neutral folder; its outputs are in the run folder and the neutral
    # folder is gone. Nothing was passed through the process environment.
    assert (out / "outputs" / "answers.json").exists()
    assert not list((synthetic.staged.parent / "mounts").iterdir())
    assert not [k for k in os.environ if k in ("BIXBENCH_V1_DATA_DIR", "BIXBENCH_V1_OUTPUTS_DIR")]
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
    assert (grades["syn-1-q1"]["correct"], grades["syn-1-q1"]["method"]) == (True, "numeric")
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
    policy = {"final_reserve": 0}  # no forced turn here: this is about the limit alone
    summary = run(
        synthetic, tmp_path / "run", "single", script, max_tokens=2500, budget_policy=policy
    )
    assert summary["status"] == "done", summary["error"]
    finished = [p for p in summary["phases"] if p["kind"] == "phase.finished"]
    assert [p["limit"] for p in finished] == ["token"] and finished[0]["tokens"] == 3000
    # Limits are checked after each call. The third call went over; the answer it submitted
    # was produced inside the budget and is recorded before the limit takes effect.
    assert summary["answer_statuses"] == dict.fromkeys(
        ["syn-1-q1", "syn-1-q2", "syn-1-q3"], "unchecked"
    )
    ledger = json.loads((tmp_path / "run" / "outputs" / "glhf" / "ledger.json").read_text())
    pending = [e for e in ledger["events"] if e["kind"] == "pending_submits.executed"]
    assert [e["questions"] for e in pending] == [["syn-1-q3"]]
    assert summary["total_tokens"] == 3000
    assert (tmp_path / "run" / "outputs" / "METHODS.md").exists()


def test_only_submit_answer_runs_past_a_limit(synthetic: Synthetic, tmp_path: Path) -> None:
    # The call that crosses the limit asks for a shell command AND an answer: the answer is
    # recorded, the command is not run.
    crossing = answer(2, "3")
    crossing.message.tool_calls = [
        *shell("touch /outputs/ran_past_the_limit").message.tool_calls,  # type: ignore[misc]
        *crossing.message.tool_calls,  # type: ignore[misc]
    ]
    script = [answer(1, "4"), crossing, DONE]
    for output in script:
        output.usage = ModelUsage(input_tokens=900, output_tokens=100, total_tokens=1000)
    out = tmp_path / "run"
    summary = run(
        # The second call ends at 2,000: over this limit, under the task's hard backstop.
        synthetic, out, "single", script, max_tokens=1800, budget_policy={"final_reserve": 0},
        question_ids=["syn-1-q1", "syn-1-q2"],
    )  # fmt: skip
    assert summary["status"] == "done", summary["error"]
    assert summary["answer_statuses"] == {"syn-1-q1": "unchecked", "syn-1-q2": "unchecked"}
    assert not (out / "outputs" / "ran_past_the_limit").exists()


def test_the_single_agent_gets_the_same_forced_final_turn(
    synthetic: Synthetic, tmp_path: Path
) -> None:
    # Budget 9,000 with the swarm derivation's reserve of 3,500: it works up to 5,500, as the
    # analyst does in test_swarm_e2e with the same numbers. Every call costs 1,000.
    script = [
        shell("echo CANDIDATE sum of a is 4"),
        answer(1, "4"),
        shell("echo CANDIDATE mean of b is 3"),
        shell("echo still thinking"),
        shell("echo still thinking"),
        shell("echo this call goes over the limit and never runs"),
        # its forced final turn: no tools but submit_answer
        answer(2, "3", route="mean of b from the log"),
        answer(3, "two genes", route="estimate: no finished computation"),
    ]
    for output in script:
        output.usage = ModelUsage(input_tokens=900, output_tokens=100, total_tokens=1000)
    out = tmp_path / "run"
    summary = run(
        synthetic, out, "single", script, max_tokens=9000, budget_policy={"final_reserve": 3500}
    )
    assert summary["status"] == "done", summary["error"]
    started = next(p for p in summary["phases"] if p["kind"] == "phase.started")
    finished = next(p for p in summary["phases"] if p["kind"] == "phase.finished")
    assert (started["tokens_allowed"], started["tokens_working"]) == (9000, 5500)
    assert finished["limit"] == "token" and finished["forced_answers"] == ["syn-1-q2", "syn-1-q3"]
    assert finished["unanswered"] == [] and finished["tokens"] == 8000 <= 9000
    assert summary["budget"]["forced_answers"] == {"single": ["syn-1-q2", "syn-1-q3"]}
    # Without the turn q2 and q3 were "missing" (and graded incorrect).
    assert summary["answer_statuses"] == dict.fromkeys(
        ["syn-1-q1", "syn-1-q2", "syn-1-q3"], "unchecked"
    )
    answers = json.loads((out / "outputs" / "answers.json").read_text())["answers"]
    assert answers["syn-1-q1"]["note"] == ""
    assert "forced estimate" in answers["syn-1-q2"]["note"]
    log = read_eval_log(str(next((out / "logs").glob("*.eval"))))
    assert log.samples is not None
    messages = [str(m.content) for m in log.samples[0].messages]
    forced = messages[messages.index("=== GLHF forced final turn: single ===") + 1]
    assert (
        "CANDIDATE mean of b is 3" in forced
        and "Record an answer for: syn-1-q2, syn-1-q3" in forced
    )
    assert "## Question syn-1-q1" not in forced  # only what is unanswered
    ledger = json.loads((out / "outputs" / "glhf" / "ledger.json").read_text())
    assert [e["kind"] for e in ledger["events"]].count("answer.forced") == 2
    graded = grade_run(out, synthetic.capsule, None)
    rows = {g["question_id"]: g for g in graded["profiles"]["per-mode"]["grades"]}
    assert rows["syn-1-q2"]["correct"] and rows["syn-1-q2"]["method"] == "range"


def test_multiple_choice_run_keeps_its_salt_on_the_host(
    synthetic: Synthetic, tmp_path: Path
) -> None:
    def letters(out: Path) -> dict[str, str]:
        script = [
            shell("env; cat /proc/1/environ | tr '\\0' '\\n'; ls -la /outputs /data"),
            *[answer(n, "A") for n in (1, 2, 3)],
            DONE,
        ]
        summary = run(synthetic, out, "single", script, answer_mode="mcq")
        assert summary["status"] == "done", summary["error"]
        salt = runner.read_salt(out)
        assert salt and len(salt) >= 32
        # The salt is in the run folder and nowhere the solver or a reader of the logs can
        # look: not the eval log, not run.json, not the outputs, not the environment.
        assert salt not in _eval_text(next((out / "logs").glob("*.eval")))
        assert salt not in (out / "run.json").read_text()
        for path in (out / "outputs").rglob("*"):
            assert path.is_dir() or salt.encode() not in path.read_bytes(), path
        assert salt not in "\x00".join(os.environ.values())
        assert "shuffle_salt" not in _eval_text(next((out / "logs").glob("*.eval")))
        # Grading rebuilds the key from the folder's salt, and writes no ideal or key letter.
        graded = grade_run(out, synthetic.capsule, None, profiles=("per-mode", "official"))
        assert graded["profiles"]["official"]["judge"]["letter_match"] is True
        key = runner.key_for(synthetic.capsule, json.loads((out / "run.json").read_text()), out)
        for grade in graded["profiles"]["per-mode"]["grades"]:
            assert grade["method"] == "letter"
            assert grade["correct"] is (key[grade["question_id"]].correct_letter == "A")
        return {q: str(entry.correct_letter) for q, entry in key.items()}

    first, second = letters(tmp_path / "one"), letters(tmp_path / "two")
    assert runner.read_salt(tmp_path / "one") != runner.read_salt(tmp_path / "two")
    # Same seed, same questions, two runs: with 4 options and 3 questions the letters agree by
    # chance 1 time in 64; with the unsalted shuffle they agreed always.
    assert first != second or runner.read_salt(tmp_path / "one") != runner.read_salt(
        tmp_path / "two"
    )


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
    # No judge: the free-text question is ungraded on both sides and leaves the paired test.
    assert (report["paired"]["n"], report["paired"]["pairs_dropped_ungraded"]) == (2, 1)
    assert report["solvers"]["glhf"]["by_status"]["reconciled"]["n"] == 1
    assert SENTINELS["ideal"] not in (out / "report.json").read_text()
    text = (out / "report.md").read_text()
    assert "| syn-1_11111111 | syn-1-q1 | 0 | str_verifier |" in text
    assert "- Comparable to published: no" in text and "scripted mock model" in text
    grade = json.loads((out / "syn-1_11111111" / "single" / "grade.json").read_text())
    assert grade["judge_model"] is None
    assert "no judge" in grade["profiles"]["per-mode"]["judge"]["deviations"][0]
