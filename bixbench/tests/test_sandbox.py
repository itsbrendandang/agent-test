"""Items 2 and 3: what a model-written cell can see and reach.

Every cell here is written by the test. Cells that try to read something
they must not print only "LEAK <label>" or "blocked <label>", never content,
so a failing sandbox cannot spill anything into the test log either.
"""

import socket
import threading
from pathlib import Path

import pytest
from conftest import FAKE_KEY

from bixbase import sandbox as sb
from bixbase.sandbox import Sandbox, SandboxUnavailable

REPO = Path(__file__).resolve().parents[2]
ALLOWED_ENV = {"PATH", "HOME", "TMPDIR", "DATA_DIR", "MPLBACKEND", "LANG",
               "OMP_NUM_THREADS"}
# set by macOS/CPython in every process, not inherited from us
OS_NOISE = {"__CF_USER_TEXT_ENCODING", "LC_CTYPE", "__PYVENV_LAUNCHER__"}
SECRETS = {
    "ANTHROPIC_API_KEY": FAKE_KEY, "OPENAI_API_KEY": FAKE_KEY,
    "OPENROUTER_API_KEY": FAKE_KEY, "EXA_API_KEY": FAKE_KEY,
    "HF_TOKEN": "hf_fake0000", "HF_HOME": "/nonexistent/hf",
    "HUGGING_FACE_HUB_TOKEN": "hf_fake0000", "GITHUB_TOKEN": "ghp_fake0000",
    "AWS_ACCESS_KEY_ID": "AKIAFAKE0000", "AWS_SECRET_ACCESS_KEY": "awsfake0000",
    "GOOGLE_APPLICATION_CREDENTIALS": "/nonexistent/gcp.json",
    "AZURE_OPENAI_API_KEY": "azfake0000", "MODEL_NAME": "fake-model",
    "PYTHONPATH": "/nonexistent/pp", "SSH_AUTH_SOCK": "/nonexistent/sock",
}
needs_seatbelt = pytest.mark.skipif(
    not sb.sandbox_available(), reason="macOS sandbox-exec only")

TRY_READ = """
import os
def attempt(label, fn):
    try:
        fn()
        print("LEAK", label)
    except Exception as e:
        print("blocked", label, type(e).__name__)
def read(p):
    return lambda: open(p, "rb").read(1)
def ls(p):
    return lambda: os.listdir(p)
"""


@pytest.fixture
def layout(tmp_path):
    """A small copy of the real layout: <root>/data/<capsule>{,.zip},
    <root>/results/<study>/rep{0,1}, <root>/.env, a fake HF cache."""
    root = tmp_path.resolve() / "repo"
    data = root / "data" / "CapsuleFolder-x"
    data.mkdir(parents=True)
    (data / "values.csv").write_text("x\n1\n2\n3\n4\n")
    (root / "data" / "CapsuleFolder-x.zip").write_bytes(b"PK-fake")
    (root / ".env").write_text(f"ANTHROPIC_API_KEY={FAKE_KEY}\n")
    rep0 = root / "results" / "s" / "rep0"
    rep0.mkdir(parents=True)
    (rep0 / "result.json").write_text('{"grades": {}}')
    hf = root / "hf_cache" / "datasets"
    hf.mkdir(parents=True)
    (hf / "BixBench.jsonl").write_text('{"ideal": "fake"}\n')
    work = root / "results" / "s" / "rep1" / "work"
    return {"root": root, "data": data, "work": work, "rep0": rep0, "hf": hf}


def run(box, code):
    r = box.run_code(code, timeout_s=120)
    return r, r.stdout + r.stderr


# -- item 2: environment ------------------------------------------------------


def _env_cell_checks(box, monkeypatch):
    for k, v in SECRETS.items():
        monkeypatch.setenv(k, v)
    r, out = run(box, "import os\nfor k, v in sorted(os.environ.items()): print(k, '=', v)")
    assert r.exit_code == 0, out
    seen = {line.split(" = ")[0] for line in r.stdout.splitlines()}
    assert seen - OS_NOISE <= ALLOWED_ENV, seen
    assert {"PATH", "HOME", "TMPDIR", "DATA_DIR", "MPLBACKEND", "LANG"} <= seen
    for k, v in SECRETS.items():
        assert k not in seen and v not in out
    env = box.cell_env()
    assert env["HOME"] == str(box.work_dir)
    assert Path(env["TMPDIR"]).parent == box.work_dir
    assert env["DATA_DIR"] == str(box.data_dir)


@needs_seatbelt
def test_cell_env_is_an_allow_list(layout, monkeypatch):
    _env_cell_checks(Sandbox(layout["data"], layout["work"]), monkeypatch)


# -- item 3: files and network (macOS) -------------------------------------------


@needs_seatbelt
def test_cell_can_work_normally(layout):
    box = Sandbox(layout["data"], layout["work"])
    r, out = run(box, (
        "import csv, os, tempfile, subprocess\n"
        "rows = list(csv.DictReader(open(os.path.join(os.environ['DATA_DIR'], 'values.csv'))))\n"
        "print('mean', sum(float(r['x']) for r in rows) / len(rows))\n"
        "open('answer.txt', 'w').write('ok')\n"
        "with tempfile.NamedTemporaryFile('w') as f: f.write('t')\n"
        "print(subprocess.run(['ls', os.environ['DATA_DIR']], capture_output=True, text=True).stdout)\n"
    ))
    assert r.exit_code == 0, out
    assert "mean 2.5" in r.stdout and "values.csv" in r.stdout
    assert "answer.txt" in r.new_files
    assert not any(".tmp" in f for f in r.new_files)


@needs_seatbelt
def test_cell_can_import_numpy_pandas(layout):
    pytest.importorskip("pandas")
    box = Sandbox(layout["data"], layout["work"])
    r, out = run(box, (
        "import os, numpy as np, pandas as pd\n"
        "df = pd.read_csv(os.path.join(os.environ['DATA_DIR'], 'values.csv'))\n"
        "print('mean', df['x'].mean(), np.linalg.svd(np.eye(3))[1].sum())\n"
        "df.to_csv('out.csv')\n"
    ))
    assert r.exit_code == 0, out
    assert "mean 2.5 3.0" in r.stdout


@needs_seatbelt
def test_cell_cannot_read_answers_secrets_or_the_repo(layout):
    box = Sandbox(layout["data"], layout["work"])
    home = Path.home()
    targets = {
        "capsule_zip": ("read", layout["data"].parent / "CapsuleFolder-x.zip"),
        "data_parent_ls": ("ls", layout["data"].parent),
        "earlier_result": ("read", layout["rep0"] / "result.json"),
        "results_ls": ("ls", layout["rep0"].parent),
        "own_run_dir_ls": ("ls", layout["work"].parent),
        "fake_env": ("read", layout["root"] / ".env"),
        "fake_hf_cache": ("read", layout["hf"] / "BixBench.jsonl"),
        # the real machine: names only, and nothing is printed on success
        "real_repo_ls": ("ls", REPO),
        "real_repo_file": ("read", REPO / "AGENTS.md"),
        "real_bixbench_ls": ("ls", REPO / "bixbench"),
        "real_home_ls": ("ls", home),
        "real_hf_cache_ls": ("ls", home / ".cache" / "huggingface"),
        "real_gitconfig": ("read", home / ".gitconfig"),
        "real_ssh_ls": ("ls", home / ".ssh"),
        "etc_passwd": ("read", "/etc/passwd"),
        "host_tmp_ls": ("ls", "/tmp"),
    }
    code = TRY_READ + "".join(
        f"attempt({label!r}, {kind}({str(path)!r}))\n"
        for label, (kind, path) in targets.items())
    r, out = run(box, code)
    assert r.exit_code == 0, out
    assert "LEAK" not in out, out
    for label in targets:
        assert f"blocked {label}" in r.stdout, (label, out)


@needs_seatbelt
def test_links_and_child_processes_do_not_escape(layout):
    box = Sandbox(layout["data"], layout["work"])
    secret = layout["rep0"] / "result.json"
    code = TRY_READ + (
        f"p = {str(secret)!r}\n"
        "os.symlink(p, 'sym')\n"
        "attempt('symlink', read('sym'))\n"
        "attempt('hardlink', lambda: (os.link(p, 'hard'), open('hard').read(1)))\n"
        "import subprocess\n"
        "c = subprocess.run(['/bin/cat', p], capture_output=True)\n"
        "print('blocked child' if c.returncode != 0 and not c.stdout else 'LEAK child')\n"
        "c = subprocess.run(['/bin/sh', '-c', 'cat \"$0\"', p], capture_output=True)\n"
        "print('blocked shell' if c.returncode != 0 and not c.stdout else 'LEAK shell')\n"
    )
    r, out = run(box, code)
    assert "LEAK" not in out, out
    for label in ("symlink", "hardlink", "child", "shell"):
        assert f"blocked {label}" in r.stdout, out
    # the host-side read_file tool must not follow the link out either
    with pytest.raises(PermissionError):
        box.resolve_in_scope("sym")
    with pytest.raises(PermissionError):
        box.resolve_in_scope(str(secret))
    with pytest.raises(PermissionError):
        box.resolve_in_scope("/tmp")


@needs_seatbelt
def test_cell_cannot_write_outside_the_work_dir(layout):
    box = Sandbox(layout["data"], layout["work"])
    outside = layout["root"] / "written.txt"
    code = TRY_READ + (
        f"attempt('data_write', lambda: open(os.path.join(os.environ['DATA_DIR'], 'h.txt'), 'w'))\n"
        f"attempt('outside_write', lambda: open({str(outside)!r}, 'w'))\n"
        f"attempt('run_dir_write', lambda: open('../result.json', 'w'))\n"
    )
    r, out = run(box, code)
    assert "LEAK" not in out and r.stdout.count("blocked") == 3, out
    assert not outside.exists() and not (layout["data"] / "h.txt").exists()


@needs_seatbelt
def test_cell_has_no_network(layout):
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    server.settimeout(3)
    port = server.getsockname()[1]
    got = []

    def accept():
        try:
            conn, _ = server.accept()
            got.append(1)
            conn.close()
        except OSError:
            pass

    t = threading.Thread(target=accept)
    t.start()
    box = Sandbox(layout["data"], layout["work"])
    code = TRY_READ + (
        "import socket\n"
        f"attempt('tcp', lambda: socket.create_connection(('127.0.0.1', {port}), timeout=2))\n"
        "attempt('dns', lambda: socket.getaddrinfo('example.invalid.', 80))\n"
        "attempt('udp', lambda: socket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendto(b'x', ('127.0.0.1', 9)))\n"
        "attempt('listen', lambda: socket.socket().bind(('127.0.0.1', 0)))\n"
    )
    r, out = run(box, code)
    t.join()
    server.close()
    assert "LEAK" not in out, out
    assert r.stdout.count("blocked") == 4, out
    assert not got, "the cell reached a TCP server on this machine"


@needs_seatbelt
def test_profile_is_deny_default_and_not_a_file_a_cell_could_edit(layout):
    box = Sandbox(layout["data"], layout["work"])
    lines = box.profile.splitlines()
    assert lines[1] == "(deny default)" and lines[-1] == "(deny network*)"
    assert "(allow default)" not in box.profile
    assert not list(layout["work"].rglob("*.sb"))
    cmd = box._wrap_cmd(["python", "x.py"])
    assert cmd[1] == "-p" and cmd[2] == box.profile
    readable = box.profile.split("(allow file-read*")[1].split("(allow file-write*")[0]
    for path in (str(REPO), str(Path.home())):
        assert f'(subpath "{path}")' not in readable


# -- item 3: no sandbox (any platform, simulated) ----------------------------------


def test_without_a_sandbox_cells_are_refused(layout, monkeypatch):
    monkeypatch.setattr(sb, "_SANDBOX_EXEC", None)
    with pytest.raises(SandboxUnavailable) as e:
        Sandbox(layout["data"], layout["work"])
    assert "--unsafe-no-sandbox" in str(e.value) and "network" in str(e.value)
    with pytest.raises(SandboxUnavailable):
        Sandbox(layout["data"], layout["work"], enforce_readonly=False)


def test_unsafe_flag_runs_but_still_allow_lists_the_env(layout, monkeypatch, capsys):
    monkeypatch.setattr(sb, "_SANDBOX_EXEC", None)
    box = Sandbox(layout["data"], layout["work"], unsafe_no_sandbox=True)
    assert "no file or network isolation" in capsys.readouterr().err
    assert box.profile is None and box._wrap_cmd(["x"]) == ["x"]
    _env_cell_checks(box, monkeypatch)


def test_run_py_refuses_without_sandbox_unless_flag(monkeypatch, tmp_path, capsys):
    import run as run_py

    def stop(*a, **k):
        raise AssertionError("must stop before loading anything")

    monkeypatch.setenv("NO_PAID_CALLS", "0")  # nothing real is reachable below
    monkeypatch.setattr(run_py, "load_dotenv", stop)
    monkeypatch.setattr(run_py, "load_studies", stop)
    monkeypatch.setattr(run_py, "LLMClient", stop)
    monkeypatch.setattr(run_py, "sandbox_available", lambda: False)
    rc = run_py.main(["--budget-tokens", "10", "--out", str(tmp_path / "o")])
    assert rc == 2 and "--unsafe-no-sandbox" in capsys.readouterr().err
    assert run_py.parse_args(
        ["--budget-tokens", "10", "--unsafe-no-sandbox"]).unsafe_no_sandbox
