"""The integrity rules of `--sandbox modal`, checked in real Modal sandboxes with the scripted
model. BILLED (a few cents) and opt-in: it runs only with

    env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u EXA_API_KEY \\
        NO_PAID_CALLS=0 BIXBENCH_V1_MODAL_TESTS=1 \\
        uv run --group modal pytest -q tests/modal_sandbox_cloud_test.py

and is skipped otherwise. No model, judge or search call is made: provider keys are removed
from the environment before anything runs. What is checked, each inside Modal's runtime:

  1. no network, no secret, no answer, no shuffle salt, exactly the staged data (single agent);
  2. the swarm's critic runs in its own new sandbox and finds nothing of the analyst's, with
     the three known side channels planted (a disguised process, a message queue, SysV IPC);
  3. why one sandbox is not enough under gVisor: the adapter's own blind check, re-run there;
  4. CPU and memory limits and the wall-clock timeout are real;
  5. no sandbox is left after a normal end, an error, and Ctrl+C.

The synthetic capsule of conftest.py is used: no benchmark data goes anywhere.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import signal
import subprocess
import sys
import textwrap
import time
from pathlib import Path
from typing import Any

import pytest
from conftest import SENTINELS, UUID, Synthetic
from inspect_ai.log import read_eval_log
from modal_sandbox_boundary_test import staged_capsule
from test_e2e import (
    ANALYST_FILES,
    AWK,
    DONE,
    PANDAS,
    SERVER,
    SUM_A,
    answer,
    call,
    rederive,
    sanswer,
    shell,
    write,
)

from bixbench_v1 import cli, modal_cost, modal_image, modal_run, paid, runner, solvers

ENABLED = os.environ.get("BIXBENCH_V1_MODAL_TESTS") == "1" and not paid.paid_calls_off()
pytestmark = pytest.mark.skipif(
    not ENABLED, reason="billed, opt-in: BIXBENCH_V1_MODAL_TESTS=1 and NO_PAID_CALLS=0"
)
if ENABLED:  # needs the optional packages (`uv run --group modal`)
    from bixbench_v1 import modal_sandbox
    from bixbench_v1.modal_sandbox import BixModalSandbox

CPU, MEMORY = 2.0, 4096
EVIDENCE = modal_image.EVIDENCE / "gvisor-blind-check.json"
LIBC = (
    "import ctypes, os\n"
    "libc = ctypes.CDLL('libc.so.6', use_errno=True)\n"
    "libc.shmat.restype = ctypes.c_void_p; libc.shmat.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_int]\n"
    "class Msg(ctypes.Structure): _fields_ = [('kind', ctypes.c_long), ('body', ctypes.c_char * 32)]\n"
)
# What a non-compliant analyst leaves that is not a file: a server renamed to look like
# Inspect's tool process, a POSIX message queue, and world-readable System V shared memory and
# message queue that hold its answer. (gVisor has no /dev/mqueue and no ipcmk listing, so the
# objects are made with system calls.)
PLANT = (
    "import socket, subprocess\n"
    + LIBC
    + f"open(os.path.expanduser('~/tmp/srv.py'), 'w').write({SERVER!r})\n"
    "subprocess.run(['bash', '-c', \"cd / && (setsid nohup bash -c 'exec -a inspect-sandbox-tools "
    "python3 $HOME/tmp/srv.py' >/dev/null 2>&1 &); sleep 2\"])\n"
    "print('ATTACK server says', socket.create_connection(('127.0.0.1', 8124), timeout=5).recv(100))\n"
    "fd = libc.mq_open(b'/A-ANSWER_q1_is_five', os.O_CREAT | os.O_RDWR, 0o666, None)\n"
    "sent = libc.mq_send(fd, b'five', 4, 0) if fd >= 0 else -1\n"
    "print('ATTACK mqueue made', fd >= 0, 'send', sent, 'errno', ctypes.get_errno())\n"
    "shmid = libc.shmget(0x5151, 4096, 0o1000 | 0o666)\n"
    "ctypes.memmove(libc.shmat(shmid, None, 0), b'A-ANSWER q1 is five', 19)\n"
    "msq = libc.msgget(0x5152, 0o1000 | 0o666)\n"
    "ok = libc.msgsnd(msq, ctypes.byref(Msg(1, b'A-ANSWER q1 is five')), 32, 0) == 0\n"
    "print('ATTACK sysv shm', shmid >= 0, 'msg', ok)\n"
)
# What the critic's user can reach of those three channels.
CHANNELS = (
    "import socket\n" + LIBC + "try:\n"
    "    print('LOOPBACK open', socket.create_connection(('127.0.0.1', 8124), timeout=3).recv(100))\n"
    "except OSError as error:\n"
    "    print('LOOPBACK closed', type(error).__name__)\n"
    "fd = libc.mq_open(b'/A-ANSWER_q1_is_five', os.O_RDONLY)\n"
    "print('MQUEUE', 'present' if fd >= 0 else 'absent')\n"
    "shmid = libc.shmget(0x5151, 0, 0o444)\n"
    "print('SYSV shm', 'reads ' + repr(ctypes.string_at(libc.shmat(shmid, None, 0o10000), 19)) if shmid >= 0 else 'absent')\n"
    "msq, got = libc.msgget(0x5152, 0o444), Msg()\n"
    "n = libc.msgrcv(msq, ctypes.byref(got), 32, 0, 0o4000) if msq >= 0 else -1\n"
    "print('SYSV msg', 'reads ' + repr(got.body) if n >= 0 else ('present' if msq >= 0 else 'absent'))\n"
    "print('KERNEL', os.uname().release, 'DEVMQ', os.path.isdir('/dev/mqueue'), 'PROCSYSV', os.path.isdir('/proc/sysvipc'))\n"
)
BOUNDARY = (
    "import os, socket, subprocess, urllib.request\n"
    "print('WHOAMI', subprocess.run(['id', '-un'], capture_output=True, text=True).stdout.strip(), 'HOME', os.environ.get('HOME'), 'CWD', os.getcwd())\n"
    "for target in (('1.1.1.1', 53), ('8.8.8.8', 443), ('api.anthropic.com', 443)):\n"
    "    try:\n"
    "        socket.create_connection(target, timeout=4); print('NETWORK up', target)\n"
    "    except OSError as error:\n"
    "        print('NETWORK down', target[0], type(error).__name__)\n"
    "try:\n"
    "    urllib.request.urlopen('https://pypi.org/simple/', timeout=4); print('NETWORK up https')\n"
    "except Exception as error:\n"
    "    print('NETWORK down https', type(error).__name__)\n"
    "try:\n"
    "    open('/data/new.txt', 'w'); print('DATA writable')\n"
    "except OSError as error:\n"
    "    print('DATA read-only', type(error).__name__)\n"
    "found = []\n"
    "for root in ('/data', '/outputs', '/home', '/tmp', '/mnt', '/workspace'):\n"
    "    for folder, _, files in os.walk(root):\n"
    "        for name in files:\n"
    "            path = os.path.join(folder, name)\n"
    "            try:\n"
    "                text = open(path, errors='ignore').read()\n"
    "            except OSError:\n"
    "                continue\n"
    "            if 'SENTINEL' in text or name.endswith(('.ipynb', '.jsonl')) or 'salt' in name:\n"
    "                found.append(path)\n"
    "print('SECRETS', found)\n"
    "print('DATA', sorted(os.path.relpath(os.path.join(f, n), '/data') for f, _, ns in os.walk('/data') for n in ns))\n"
    "print('FIND', subprocess.run('find /data -type f | wc -l', shell=True, capture_output=True, text=True).stdout.strip())\n"
    "print('ENVNAMES', sorted(os.environ))\n"
    "print('MODALDIR', os.access('/__modal/volumes', os.R_OK), os.path.lexists('/mnt/bix-staged'))\n"
)
CRITIC_PROBE = (
    BOUNDARY + f"names = {set(ANALYST_FILES) | {'a.py', 'srv.py'}!r}\n"
    "seen = []\n"
    "for folder, dirs, files in os.walk('/'):\n"
    "    dirs[:] = [d for d in dirs if os.path.join(folder, d) not in ('/proc', '/sys', '/data', '/opt', '/usr')]\n"
    "    seen += [os.path.join(folder, n) for n in dirs + files if n in names]\n"
    "print('ANALYST_PATHS', seen)\n"
    "print('OUTPUTS', os.listdir('/outputs'), 'WORK', os.listdir(os.path.expanduser('~/work')))\n"
    "print('ANALYST_HOME', os.path.exists('/home/deriv_a/work/notes.txt'))\n"
    + CHANNELS.replace("import socket\n", "", 1)
)
ROOT_GREP = (
    "grep -rIl -e SENTINEL -e " + UUID + " -e 'syn-1' -e shuffle_salt / "
    "--exclude-dir=proc --exclude-dir=sys --exclude-dir=opt --exclude-dir=usr --exclude-dir=.udocker "
    "--exclude-dir=reconcile --exclude-dir=.debug_shell 2>/dev/null | sed 's/^/ROOTGREP /'; "
    "(env; cat /proc/1/environ | tr '\\0' '\\n'; cat /proc/self/mountinfo; "
    "strings /__modal/.container-arguments/data.bin 2>/dev/null) "
    "| grep -c -e SENTINEL -e " + UUID + " -e 'syn-1' | sed 's/^/ROOTENV /'"
)


@pytest.fixture(scope="module", autouse=True)
def leave_the_volume_as_it_was() -> Any:
    """The synthetic capsule is zipped anew for every test, so each test uploads a new (tiny)
    folder. Whatever these tests added to the Volume is removed when they are done, and the
    Volume is audited: only staged data folders, nothing that must never be uploaded."""
    import modal

    from bixbench_v1 import modal_stage

    volume = modal.Volume.from_name(modal_stage.VOLUME_NAME, create_if_missing=True)
    before = {str(entry.path).strip("/") for entry in volume.listdir("/")}
    yield
    for entry in volume.listdir("/"):
        name = str(entry.path).strip("/")
        if name not in before:
            volume.remove_file(f"/{name}", recursive=True)
    assert {str(entry.path).strip("/") for entry in volume.listdir("/")} == before
    assert modal_stage.audit_volume(volume) == []
    assert alive() == []  # and no sandbox of the app is running


@pytest.fixture(autouse=True)
def no_provider_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in paid.PAID_KEYS:  # nothing but Modal can be reached from these tests
        monkeypatch.delenv(key, raising=False)


def ledgers(tmp_path: Path) -> list[Path]:
    return [tmp_path / modal_cost.LEDGER_NAME, cli.MODAL_LEDGER]  # real spend is recorded


def run(
    synthetic: Synthetic, out: Path, solver: str, script: list[Any], **kw: Any
) -> dict[str, Any]:
    return runner.run_capsule(
        synthetic.capsule, hub_dir=synthetic.hub, staged_root=synthetic.staged, out_dir=out,
        solver=solver, model="mock", time_limit_seconds=300, mock_outputs=script,
        sandbox="modal", modal_cpu=CPU, modal_memory_mib=MEMORY,
        modal_ledgers=ledgers(out.parent), modal_usd_cap=1.0, **kw,
    )  # fmt: skip


def eval_text(out: Path) -> str:
    log = read_eval_log(str(next((out / "logs").glob("*.eval"))))
    assert log.samples is not None
    return "\n".join(str(m.content) for m in log.samples[0].messages)


def tool_output(out: Path, marker: str, containing: str = "") -> str:
    """The output of the one tool call whose output starts with `marker` (the reconciler is
    shown both sides' commands and outputs again, so the whole transcript repeats them)."""
    log = read_eval_log(str(next((out / "logs").glob("*.eval"))))
    assert log.samples is not None
    found = [
        str(m.content)
        for m in log.samples[0].messages
        if m.role == "tool"
        and str(m.content).lstrip().startswith(marker)
        and containing in str(m.content)
    ]
    assert found, f"no tool output starts with {marker!r} and contains {containing!r}"
    return found[0]


def alive(run_tag: str | None = None) -> list[str]:
    return modal_sandbox.live_sandboxes(modal_image.APP_NAME, run_tag)


# 1 ------------------------------------------------------------------------------------------------
def test_single_agent_sandbox_has_no_network_no_secret_no_answer_and_the_staged_data(
    synthetic: Synthetic, tmp_path: Path
) -> None:
    out = tmp_path / "single"
    script = [
        shell("env; cat /proc/1/environ 2>&1 | tr '\\0' '\\n'; cat /proc/self/mountinfo; ls -la /outputs /data; id -un; echo HOME=$HOME; pwd"),
        call("python", code=BOUNDARY),
        *[answer(n, "A") for n in (1, 2, 3)],
        DONE,
    ]  # fmt: skip
    summary = run(synthetic, out, "single", script, answer_mode="mcq")
    assert summary["status"] == "done", summary["error"]
    settings = summary["settings"]
    assert settings["sandbox"] == "modal" and settings["network"] == "none"
    assert settings["network_probe"] == "passed" and settings["modal"]["data_probe"] == "passed"
    assert settings["image"] == modal_image.PUBLISHED and str(settings["image_id"]).startswith(
        "im-"
    )
    assert settings["modal"]["sandboxes"] == 1 and settings["modal"]["outputs_copied"] is True
    assert settings["modal"]["errors"] == [] and settings["modal"]["left_over_terminated"] == []
    assert (
        "x86_64" in settings["modal"]["machines"][0]
        and "gvisor" in settings["modal"]["machines"][0]
    )
    text = eval_text(out)
    # As the role user, with that user's HOME, in the same working directory as in Docker.
    assert "WHOAMI deriv_a HOME /home/deriv_a CWD /home" in text and "HOME=/home/deriv_a" in text
    # No network: TCP by address, by name, and HTTPS all fail from inside.
    probe = tool_output(out, "WHOAMI")
    assert probe.count("NETWORK down") == 4 and "NETWORK up" not in probe
    # Only the capsule's input files, as a real read-only directory; nothing secret anywhere.
    assert "DATA read-only PermissionError" in text and "SECRETS []" in text
    assert "DATA ['counts.csv', 'nested/meta.txt', 'results.busco.zip']" in text
    assert "FIND 3" in text  # /data is a real directory: `find /data -type f` works as in Docker
    assert "MODALDIR False False" in text  # the mounted Volume is hidden from the role user
    names = text.split("ENVNAMES", 1)[1].split("\n", 1)[0]
    for word in (
        "KEY",
        "TOKEN",
        "SECRET",
        "MODAL",
        "PYTHONHASHSEED",
        "PYTHONPATH",
        "ANTHROPIC",
        "OPENAI",
    ):
        assert word not in names, names
    # The capsule's uuid and key, the answers and the shuffle salt are in nothing the solver
    # saw: its environment, /proc/1/environ, the mount table, the directory listings.
    # (In multiple-choice mode the ideal and the distractors are on screen as options.)
    hidden = {k: v for k, v in SENTINELS.items() if k not in ("ideal", "distractor")}
    for secret in (UUID, *hidden.values()):
        assert secret not in text, secret
    salt = runner.read_salt(out)
    assert salt and len(salt) >= 32
    raw = (next((out / "logs").glob("*.eval"))).read_bytes()
    assert salt.encode() not in raw and salt not in (out / "run.json").read_text()
    for path in (out / "outputs").rglob("*"):
        assert path.is_dir() or salt.encode() not in path.read_bytes(), path
    assert "shuffle_salt" not in text and "bixbench" not in text.lower().replace("bixbench v1", "")
    # The same files a Docker run leaves, and one ledger line with a cost.
    assert (out / "outputs" / "answers.json").exists() and (out / "outputs" / "METHODS.md").exists()
    lines = modal_cost.read(out / modal_cost.LEDGER_NAME)
    assert len(lines) == 1 and lines[0]["usd"] > 0 and lines[0]["capsule"] == synthetic.capsule.key
    assert lines[0]["resource"] == {"cpu": CPU, "memory_gib": MEMORY / 1024, "gpu": None}
    assert alive(settings["modal"]["run_tag"]) == []


# 2 ------------------------------------------------------------------------------------------------
def test_the_critic_works_in_its_own_sandbox_and_finds_nothing_of_the_analysts(
    synthetic: Synthetic, tmp_path: Path
) -> None:
    out = tmp_path / "swarm"
    script = [
        shell(
            "echo 'sum is four' > ~/work/notes.txt; echo 'print(4)' > ~/work/a.py; "
            "echo scratch > /tmp/scratch_a.txt; echo x > /var/tmp/answer_is_five.txt; "
            "echo x > /dev/shm/shm_a.txt; mkdir /tmp/a_dir; echo x > /tmp/a_dir/inner.txt; "
            "echo five > /outputs/leak_a.txt; chmod -R a+rX ~ /tmp/a_dir; id -un"
        ),
        call("python", code=PLANT),
        sanswer(1, "5", PANDAS, route="summed column a"),  # wrong on purpose
        sanswer(2, "3.0", "data=counts.csv column b; subset=all rows; procedure=mean; tool=pandas.mean"),
        sanswer(3, "two genes, two samples", "data=counts.csv; subset=header and rows; procedure=read it; tool=head"),
        DONE,
        call("python", code=CRITIC_PROBE),
        sanswer(1, "4", AWK, route="awk over the csv"),
        sanswer(2, "3", "data=counts.csv third field; subset=two data lines; procedure=average by hand; tool=awk"),
        sanswer(3, "a small count table", "data=counts.csv; subset=whole file; procedure=describe shape; tool=wc"),
        DONE,
        shell(ROOT_GREP),
        write("/root/reconcile/q1.py", SUM_A),
        rederive(1, "/root/reconcile/q1.py", "4", "A added the header row index"),
        write("/root/reconcile/q3.sh", "head -n 1 /data/counts.csv > /dev/null\necho a small count table"),
        rederive(3, "/root/reconcile/q3.sh", "a small count table", "same description in different words", text_matches="both"),
        DONE,
    ]  # fmt: skip
    summary = run(synthetic, out, "glhf", script, max_tokens=500_000)
    assert summary["status"] == "done", summary["error"]
    # The same mechanics as the Docker run of tests/test_e2e.py.
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
    modal = summary["settings"]["modal"]
    assert modal["sandboxes"] == 2 and modal["critic_isolation"] == "a separate, new sandbox"
    assert modal["errors"] == [] and len(set(modal["sandbox_ids"])) == 2
    # The analyst's attack worked in its own sandbox (so what follows means something).
    attack = tool_output(out, "ATTACK")
    assert "ATTACK server says b'A-ANSWER q1 is five'" in attack
    assert "ATTACK mqueue made True" in attack and "ATTACK sysv shm True msg True" in attack
    # The critic: its own user, no network, read-only data, an empty start, and nothing of the
    # analyst's: no file, no home, no /outputs entry, no process, no queue, no SysV object.
    critic = tool_output(out, "WHOAMI")
    assert "WHOAMI deriv_b HOME /home/deriv_b" in critic
    assert critic.count("NETWORK down") == 4 and "NETWORK up" not in critic
    assert "DATA read-only PermissionError" in critic and "SECRETS []" in critic
    assert "ANALYST_PATHS []" in critic and "OUTPUTS [] WORK []" in critic
    assert "ANALYST_HOME False" in critic
    assert "LOOPBACK closed ConnectionRefusedError" in critic
    assert "MQUEUE absent" in critic and "SYSV shm absent" in critic and "SYSV msg absent" in critic
    assert summary["blind_check"] == {"checked": True, "visible_to_critic": []}
    # Root, in the critic's sandbox: no file anywhere names the capsule or holds an answer, and
    # neither do the environment, the mount table or Modal's own container arguments.
    # (/__modal/.debug_shell is Modal's own tool store, the same in every sandbox; skipped.)
    root = tool_output(out, "", containing="ROOTENV")
    assert re.findall(r"ROOTGREP (\S+)", root) == [] and re.findall(r"ROOTENV (\d+)", root) == ["0"]
    # The analyst's script was carried on the host and is in the run folder with the others.
    work = out / "outputs" / "glhf" / "work"
    assert (work / "deriv_a" / "a.py").read_text().strip() == "print(4)"
    assert (work / "root" / "q1.py").exists() and (out / "outputs" / "answers.json").exists()
    assert not (out / "outputs" / "leak_a.txt").exists()  # the analyst's /outputs file is gone
    lines = modal_cost.read(out / modal_cost.LEDGER_NAME)
    assert [line["what"] for line in lines] == [
        "analyst's sandbox, replaced for the critic",
        "run ended",
    ]
    assert alive(modal["run_tag"]) == []


# 3 and 4: straight through the provider, without a model ---------------------------------------
class Direct:
    """A provider sandbox for the synthetic capsule, driven by hand."""

    def __init__(self, synthetic: Synthetic, tmp_path: Path, **size: Any) -> None:
        data_dir, manifest = staged_capsule(synthetic)
        self.loop = asyncio.new_event_loop()
        modal_sandbox.upstream.sandbox_cleanup_startup()
        self.run = modal_run.prepare(
            data_dir=data_dir, manifest=manifest, outputs_dir=tmp_path / "outputs",
            run_dir=tmp_path / "direct", run_name="syn-1/direct", capsule=synthetic.capsule.key,
            solver="glhf", time_limit_seconds=size.pop("time_limit", 300), backstop_seconds=0,
            cpu=size.pop("cpu", CPU), memory_mib=size.pop("memory_mib", MEMORY),
            ledgers=ledgers(tmp_path), usd_cap=1.0,
        )  # fmt: skip
        envs = self.loop.run_until_complete(
            BixModalSandbox.sample_init("direct", self.run.config, {})
        )
        self.env = envs["default"].as_type(BixModalSandbox)

    def sh(self, script: str, user: str = "root", timeout: int = 180) -> str:
        result = self.loop.run_until_complete(
            self.env.exec(["bash", "-c", script], user=user, timeout=timeout)
        )
        return result.stdout + result.stderr

    def py(self, code: str, user: str) -> str:
        result = self.loop.run_until_complete(
            self.env.exec(["python3", "-c", code], user=user, timeout=120)
        )
        return result.stdout + result.stderr

    def close(self) -> None:
        try:
            self.env.close("test ended")
        finally:
            self.run.finish()
            self.loop.close()


def blind_steps(box: Direct) -> dict[str, str]:
    """The adapter's own blind check (solvers.blind_check), step by step, in this sandbox."""
    killed = box.loop.run_until_complete(
        box.env.exec(
            ["python3", "-c", solvers._USER_PROCESSES, "kill", solvers.USER_A], user="root"
        )
    )
    for owner in (solvers.USER_A, "root"):
        box.sh(solvers._IPC_REMOVE, user=owner)
    box.sh(solvers._BLIND)
    return {
        "processes_left_after_kill": killed.stdout.strip(),
        "blind_check_output": box.sh(solvers._BLIND_CHECK, user=solvers.USER_B).strip(),
        "critic_can_reach": box.py(CHANNELS, solvers.USER_B).strip(),
    }


def test_one_sandbox_is_not_blind_under_gvisor_and_a_new_one_is(
    synthetic: Synthetic, tmp_path: Path
) -> None:
    box = Direct(synthetic, tmp_path)
    try:
        box.sh(solvers._SETUP)
        planted = box.py(PLANT, solvers.USER_A)
        assert "ATTACK server says" in planted and "ATTACK sysv shm True msg True" in planted
        same = blind_steps(box)
        # (a) the disguised process: killed by uid, as in Docker. The check PASSES.
        assert same["processes_left_after_kill"] == "[]"
        assert "LOOPBACK closed" in same["critic_can_reach"]
        # (b) /dev/mqueue: there is no such mount, so the adapter's check has nothing to list
        # or empty. No message can be sent (ENOSYS, errno 38), but the queue the analyst made
        # is still there for the critic, and a NAME can carry an answer. The check FAILS OPEN.
        assert "DEVMQ False" in same["critic_can_reach"] and "send -1 errno 38" in planted
        assert "MQUEUE present" in same["critic_can_reach"]
        assert "message queue" not in same["blind_check_output"]
        # (c) System V IPC: FAILS. There is no /proc/sysvipc, `ipcrm -a` removes nothing, the
        # check prints nothing, and the critic's user reads the analyst's answer from both.
        assert "PROCSYSV False" in same["critic_can_reach"]
        assert "sysv ipc" not in same["blind_check_output"]
        assert "SYSV shm reads b'A-ANSWER q1 is five'" in same["critic_can_reach"]
        assert "SYSV msg reads b'A-ANSWER q1 is five'" in same["critic_can_reach"]
        first = box.env.sandbox.object_id
        # The provider's answer: a new sandbox for the critic. The same steps, there.
        box.loop.run_until_complete(box.env.fresh_sandbox(keep=[]))
        assert box.env.sandbox.object_id != first
        box.sh(solvers._SETUP)
        new = blind_steps(box)
        assert new["processes_left_after_kill"] == "[]" and new["blind_check_output"] == ""
        for line in ("LOOPBACK closed", "MQUEUE absent", "SYSV shm absent", "SYSV msg absent"):
            assert line in new["critic_can_reach"], new
        EVIDENCE.write_text(
            json.dumps(
                {
                    "measured": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "image": modal_image.PUBLISHED,
                    "planted_by_the_analyst": planted.strip().splitlines(),
                    "same_sandbox_after_the_adapters_blind_steps": same,
                    "new_sandbox_after_the_same_steps": new,
                    "verdict": {
                        "disguised background process": "passes (killed by uid; loopback closed)",
                        "/dev/mqueue": "the check cannot work under gVisor (there is no "
                        "/dev/mqueue mount to list or empty). No message can be sent (mq_send is "
                        "not implemented), but a queue the analyst made still exists for the "
                        "critic and a name can carry an answer: fails open in one sandbox; "
                        "passes with a new sandbox for the critic",
                        "System V IPC": "FAILS in one sandbox (no /proc/sysvipc, ipcrm -a removes "
                        "nothing, the check sees nothing, the critic's user reads the data); "
                        "passes with a new sandbox for the critic",
                    },
                },
                indent=1,
            )
            + "\n"
        )
    finally:
        box.close()
    assert alive(box.run.config.run_tag) == []


def test_cpu_and_memory_limits_are_set_and_the_sandbox_ends_at_its_timeout(
    synthetic: Synthetic, tmp_path: Path
) -> None:
    box = Direct(synthetic, tmp_path, cpu=1.0, memory_mib=1024, time_limit=60)
    try:
        assert box.run.config.timeout_seconds == 60 + 600
        seen = box.sh(
            "nproc; cat /sys/fs/cgroup/memory/memory.limit_in_bytes; grep MemTotal /proc/meminfo"
        )
        assert seen.split()[0] == "1" and seen.split()[1] == str(1024 * 1024 * 1024), seen
        # Past the memory limit Modal ends the whole sandbox, not only the process.
        try:
            box.py(
                "b = bytearray(1500 * 1024 * 1024)\nfor i in range(0, len(b), 4096): b[i] = 1\nprint('survived')",
                "root",
            )
        except Exception:
            pass
        deadline = time.time() + 60
        while (
            time.time() < deadline
            and box.loop.run_until_complete(box.env.sandbox.poll.aio()) is None
        ):
            time.sleep(2)
        assert box.loop.run_until_complete(box.env.sandbox.poll.aio()) is not None
    finally:
        box.close()
    # A sandbox with a short lifetime ends by itself: no client is needed to stop it.
    import modal

    app = modal.App.lookup(modal_image.APP_NAME, create_if_missing=True)
    started = time.time()
    sandbox = modal.Sandbox.create(
        "sleep", "infinity", app=app, image=modal.Image.from_name(modal_image.PUBLISHED),
        timeout=20, cpu=(0.5, 0.5), memory=(512, 512), block_network=True,
    )  # fmt: skip
    try:
        while time.time() < started + 90 and sandbox.poll() is None:
            time.sleep(3)
        lived = time.time() - started
        assert sandbox.poll() is not None and lived < 80, lived
    finally:
        sandbox.terminate()
        modal_cost.append(
            ledgers(tmp_path),
            modal_cost.sandbox_line(seconds=lived, cpu=0.5, memory_mib=512, what="timeout test", sandbox_id=sandbox.object_id),
        )  # fmt: skip


# 5 ------------------------------------------------------------------------------------------------
def test_no_sandbox_is_left_after_an_error(
    synthetic: Synthetic, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    out = tmp_path / "error"

    async def broken(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("forced failure after the solver")

    monkeypatch.setattr(solvers, "_write_outputs", broken)
    before = set(modal_sandbox.RUNS)
    summary = run(synthetic, out, "single", [shell("ls /data"), answer(1, "4"), DONE])
    assert summary["status"] == "failed" and "forced failure" in str(summary["error"])
    (tag,) = set(modal_sandbox.RUNS) - before
    assert alive(tag) == []
    lines = modal_cost.read(out / modal_cost.LEDGER_NAME)
    assert len(lines) == 1 and lines[0]["usd"] > 0
    # A sandbox that fails its probe is terminated before the solver ever sees it.
    monkeypatch.undo()
    monkeypatch.setattr(
        modal_sandbox.boundary, "probe_problems", lambda result, config: ["forced refusal"]
    )
    before = set(modal_sandbox.RUNS)
    refused = run(synthetic, tmp_path / "refused", "single", [DONE])
    assert refused["status"] == "failed" and "forced refusal" in str(refused["error"])
    (tag,) = set(modal_sandbox.RUNS) - before
    assert alive(tag) == []
    assert (
        modal_cost.read(tmp_path / "refused" / modal_cost.LEDGER_NAME)[0]["what"]
        == "refused at start"
    )


DRIVER = """
import sys
from pathlib import Path
sys.path.insert(0, {tests!r})
from test_e2e import DONE, answer, call
from bixbench_v1 import runner
from bixbench_v1.dataset import group_capsules, load_questions
hub, staged, out = Path({hub!r}), Path({staged!r}), Path({out!r})
capsule = group_capsules(load_questions(hub / "BixBench.jsonl"))[0]
print("START", flush=True)
summary = runner.run_capsule(
    capsule, hub_dir=hub, staged_root=staged, out_dir=out, solver="single", model="mock",
    time_limit_seconds=300,
    mock_outputs=[call("python", code="import time; print('began', flush=True); time.sleep(200)"), answer(1, "4"), DONE],
    sandbox="modal", modal_cpu={cpu}, modal_memory_mib={memory},
    modal_ledgers=[Path({ledger!r}), Path({cumulative!r})], modal_usd_cap=1.0,
)
print("RETURNED", summary["status"], summary["error"], summary["settings"]["modal"], flush=True)
"""


def test_no_sandbox_is_left_after_ctrl_c(synthetic: Synthetic, tmp_path: Path) -> None:
    out = tmp_path / "interrupted"
    driver = tmp_path / "driver.py"
    driver.write_text(
        textwrap.dedent(DRIVER).format(
            tests=str(Path(__file__).parent),
            hub=str(synthetic.hub),
            staged=str(synthetic.staged),
            out=str(out),
            cpu=CPU,
            memory=MEMORY,
            ledger=str(tmp_path / modal_cost.LEDGER_NAME),
            cumulative=str(cli.MODAL_LEDGER),
        )
    )
    assert alive() == [], "another run's sandbox is alive; this test needs the app to itself"
    child = subprocess.Popen(
        [sys.executable, str(driver)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        env={k: v for k, v in os.environ.items() if k not in paid.PAID_KEYS},
    )  # fmt: skip
    try:
        deadline = time.time() + 180
        mine: list[str] = []
        while time.time() < deadline and not mine and child.poll() is None:
            time.sleep(3)
            mine = alive()
        assert mine, "the run never started a sandbox: " + (
            child.stdout.read() if child.stdout else ""
        )
        time.sleep(20)  # let the solver get into its `sleep 200`
        child.send_signal(signal.SIGINT)  # Ctrl+C
        child.wait(timeout=120)
    finally:
        if child.poll() is None:
            child.kill()
    output = child.stdout.read() if child.stdout else ""
    # Listed afterwards: nothing of the app is running, and the sandbox has its ledger line.
    for _ in range(10):
        if not alive():
            break
        time.sleep(3)
    assert alive() == [], output[-2000:]
    lines = modal_cost.read(tmp_path / modal_cost.LEDGER_NAME)
    assert [line["sandbox_id"] for line in lines] == mine and lines[0]["usd"] > 0, output[-2000:]
    assert lines[0]["seconds"] < 150  # ended by the interrupt, not by the 200-second sleep
    status = json.loads((out / "run.json").read_text())["status"]
    assert status != "done", (status, child.returncode, output[-2000:])
