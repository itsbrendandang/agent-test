"""The rules of `--sandbox modal` that need no cloud and no Modal package: what a sandbox may be
created with, what a probe result must say, how /outputs is unpacked, what may be uploaded to
the Volume, and the cost ledger. Each guard has a test that fails when the guard is removed."""

from __future__ import annotations

import io
import json
import subprocess
import sys
import tarfile
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from conftest import SENTINELS, UUID, Synthetic

from bixbench_v1 import modal_boundary as boundary
from bixbench_v1 import modal_cost, modal_stage, staging
from bixbench_v1.modal_boundary import BixModalConfig
from bixbench_v1.task import bixbench_v1

KEY = "0123456789abcdef0123456789abcdef"
CONFIG = BixModalConfig(
    run_tag="a" * 32,
    image="bixbench-v1-env:amd64-1",
    app="bixbench-v1-sandbox",
    volume="bixbench-v1-staged-test",
    data_path=f"/{KEY}/data",
    files=3,
    listing_sha256="1" * 64,
    content_sha256="2" * 64,
    timeout_seconds=900,
)
GOOD_PROBE = {
    "reached": [],
    "secret_names": [],
    "forbidden_files": [],
    "not_regular": [],
    "files": 3,
    "listing_sha256": "1" * 64,
    "content_sha256": "2" * 64,
    "data_writable_by_others": False,
    "volume_visible_to_others": False,
}


# What a sandbox is created with -------------------------------------------------------------------
def real_kwargs() -> dict[str, Any]:
    plan = boundary.sandbox_plan(CONFIG)
    return {
        "app": object(),
        "image": object(),
        "workdir": plan["workdir"],
        "block_network": plan["block_network"],
        "volumes": {plan["volume"]["mount"]: object()},
        "cpu": plan["cpu"],
        "memory": plan["memory"],
        "timeout": plan["timeout"],
    }


def test_the_plan_blocks_the_network_mounts_one_read_only_folder_and_sets_limits() -> None:
    plan = boundary.sandbox_plan(CONFIG)
    assert plan["block_network"] is True
    assert plan["volume"] == {
        "name": "bixbench-v1-staged-test",
        "mount": "/mnt/bix-staged",
        "sub_path": f"/{KEY}/data",
        "read_only": True,
    }
    assert plan["cpu"] == (4.0, 4.0) and plan["memory"] == (16384, 16384)  # request = limit
    assert plan["timeout"] == 900 and plan["command"] == ["sleep", "infinity"]
    assert plan["workdir"] == "/home"
    assert plan["tags"] == {"created_by": "inspect-ai", "bixbench_v1_run": "a" * 32}
    assert not set(plan) & set(boundary.FORBIDDEN_KWARGS)
    boundary.check_create_kwargs(real_kwargs())  # the plan itself passes


@pytest.mark.parametrize("name", boundary.FORBIDDEN_KWARGS)
def test_a_sandbox_is_never_created_with_a_secret_a_port_or_an_allow_list(name: str) -> None:
    kwargs = real_kwargs() | {name: ["x"]}
    with pytest.raises(ValueError, match=name):
        boundary.check_create_kwargs(kwargs)


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"block_network": False}, "block_network"),
        ({"volumes": {"/mnt/bix-staged": 1, "/extra": 2}}, "exactly one Volume"),
        ({"volumes": {"/data": 1}}, "exactly one Volume"),
        ({"timeout": None}, "timeout"),
        ({"timeout": 10**6}, "timeout"),
        ({"cpu": 4.0}, "cpu limit"),
        ({"cpu": (2.0, 8.0)}, "cpu limit"),
        ({"memory": 16384}, "memory limit"),
    ],
)
def test_a_sandbox_without_a_limit_a_timeout_or_the_network_block_is_refused(
    change: dict[str, Any], message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        boundary.check_create_kwargs(real_kwargs() | change)


def test_the_config_holds_no_host_path_and_no_capsule_name() -> None:
    dumped = json.dumps(CONFIG.model_dump())
    assert "/Users" not in dumped and "/home/" not in dumped and UUID not in dumped
    with pytest.raises(ValueError):  # a data path that names the capsule is refused
        BixModalConfig(**(CONFIG.model_dump() | {"data_path": f"/{UUID}/data"}))
    with pytest.raises(ValueError):  # and so is a lifetime without an end
        BixModalConfig(**(CONFIG.model_dump() | {"timeout_seconds": 10**7}))


def test_the_sandbox_lives_as_long_as_the_run_plus_a_margin_and_never_past_a_day() -> None:
    assert boundary.sandbox_timeout(1800, 180) == 1800 + 180 + 600
    assert boundary.sandbox_timeout(10**6, 180) == 24 * 3600


# The probe ------------------------------------------------------------------------------------------
def test_a_clean_probe_passes_and_every_finding_is_a_problem() -> None:
    assert boundary.probe_problems(GOOD_PROBE, CONFIG) == []
    for change, word in (
        ({"reached": ["tcp 1.1.1.1:443"]}, "network"),
        ({"secret_names": ["ANTHROPIC_API_KEY"]}, "secret-like"),
        ({"forbidden_files": ["/data/BixBench.jsonl"]}, "must not be"),
        ({"not_regular": ["/data/link"]}, "not a file"),
        ({"files": 4}, "staged file list"),
        ({"listing_sha256": "9" * 64}, "staged file list"),
        ({"content_sha256": "9" * 64}, "other contents"),
        ({"data_writable_by_others": True}, "writable"),
        ({"volume_visible_to_others": True}, "visible"),
    ):
        problems = boundary.probe_problems(GOOD_PROBE | change, CONFIG)
        assert len(problems) == 1 and word in problems[0], (change, problems)


def test_a_probe_that_did_not_answer_is_not_a_pass() -> None:
    # A missing field is a finding, not a default.
    empty = boundary.probe_problems({}, CONFIG)
    assert any("staged file list" in p for p in empty) and any("writable" in p for p in empty)
    with pytest.raises(ValueError):
        boundary.parse_probe("Traceback (most recent call last):\n  boom\n")
    assert boundary.parse_probe('noise\n{"reached": []}\n') == {"reached": []}


def test_the_probe_script_is_valid_python_and_looks_for_the_network_and_the_answers() -> None:
    compile(boundary.PROBE, "probe", "exec")
    for needle in ("api.anthropic.com", "1.1.1.1", "BixBench.jsonl", "shuffle_salt.json", "sha256"):
        assert needle in boundary.PROBE


def test_commands_run_without_the_variables_modal_adds() -> None:
    cmd = boundary.clean_env_command(["python3", "x.py"])
    assert cmd[0] == "/usr/bin/env" and cmd[-2:] == ["python3", "x.py"]
    for name in ("PYTHONHASHSEED", "PYTHONPATH", "MODAL_SANDBOX_ID", "MODAL_IMAGE_ID"):
        assert cmd[cmd.index(name) - 1] == "-u"
    kept = boundary.clean_env_command(["true"], {"PYTHONPATH": "/x"})
    assert "PYTHONPATH" not in kept and "PYTHONHASHSEED" in kept  # the caller's own value stays


# Unpacking what the sandbox returns ---------------------------------------------------------------
def archive(members: list[tuple[tarfile.TarInfo, bytes | None]]) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for info, data in members:
            tar.addfile(info, io.BytesIO(data) if data is not None else None)
    return buffer.getvalue()


def file_member(name: str, data: bytes = b"x") -> tuple[tarfile.TarInfo, bytes]:
    info = tarfile.TarInfo(name)
    info.size = len(data)
    return info, data


def special(name: str, kind: bytes, target: str = "") -> tuple[tarfile.TarInfo, None]:
    info = tarfile.TarInfo(name)
    info.type, info.linkname = kind, target
    return info, None


def test_outputs_are_unpacked_as_plain_files_inside_the_target(tmp_path: Path) -> None:
    directory = tarfile.TarInfo("./glhf")
    directory.type = tarfile.DIRTYPE
    payload = archive(
        [
            file_member("./answers.json", b'{"answers": {}}'),
            (directory, None),
            file_member("./glhf/work/deriv_a/s.py", b"print(1)"),
        ]
    )
    files = boundary.safe_members(payload)
    assert [name for name, _ in files] == ["answers.json", "glhf/work/deriv_a/s.py"]
    assert boundary.write_members(files, tmp_path / "out") == 2
    assert (tmp_path / "out" / "glhf" / "work" / "deriv_a" / "s.py").read_bytes() == b"print(1)"
    # Kept files never replace what the final sandbox wrote.
    assert (
        boundary.write_members([("answers.json", b"old")], tmp_path / "out", overwrite=False) == 0
    )
    assert (tmp_path / "out" / "answers.json").read_bytes() == b'{"answers": {}}'


@pytest.mark.parametrize(
    "members",
    [
        [file_member("/etc/passwd")],
        [file_member("../escape.txt")],
        [file_member("a/../../escape.txt")],
        [special("link", tarfile.SYMTYPE, "/etc/passwd")],
        [special("hard", tarfile.LNKTYPE, "answers.json")],
        [special("dev", tarfile.CHRTYPE)],
        [special("fifo", tarfile.FIFOTYPE)],
        [file_member("bad\nname")],
    ],
)
def test_an_archive_with_a_link_a_device_or_a_path_outside_is_refused(
    members: list[tuple[tarfile.TarInfo, bytes | None]], tmp_path: Path
) -> None:
    with pytest.raises(boundary.UnsafeArchive):
        boundary.safe_members(archive(members))
    assert not list(tmp_path.iterdir())


def test_an_archive_that_is_too_large_or_not_an_archive_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(boundary.UnsafeArchive, match="unreadable"):
        boundary.safe_members(b"not a tar file")
    monkeypatch.setattr(boundary, "MAX_MEMBERS", 2)
    with pytest.raises(boundary.UnsafeArchive, match="too many"):
        boundary.safe_members(archive([file_member(f"f{i}") for i in range(3)]))
    monkeypatch.setattr(boundary, "MAX_ARCHIVE_BYTES", 100)
    with pytest.raises(boundary.UnsafeArchive, match="more than 50 MB"):
        boundary.safe_members(archive([file_member("big", b"\0" * 500)]))
    with pytest.raises(boundary.UnsafeArchive, match="limit is 50 MB"):
        boundary.safe_members(b"x" * 101)


def test_nothing_is_written_through_a_link_or_outside_the_folder(tmp_path: Path) -> None:
    out, outside = tmp_path / "out", tmp_path / "outside"
    out.mkdir()
    outside.mkdir()
    (out / "glhf").symlink_to(outside, target_is_directory=True)
    with pytest.raises(boundary.UnsafeArchive):
        boundary.write_members([("glhf/x.txt", b"x")], out)
    with pytest.raises(boundary.UnsafeArchive):
        boundary.write_members([("../x.txt", b"x")], out)
    assert not list(outside.iterdir()) and not (tmp_path / "x.txt").exists()


# What goes to the Volume ----------------------------------------------------------------------------
class FakeVolume:
    """Records uploads and serves them back, as `modal.Volume` does."""

    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}
        self.uploads = 0
        self.drop: str | None = None  # a path the fake "loses", to test the read-back

    def batch_upload(self, force: bool = False) -> FakeVolume:
        self.uploads += 1
        return self

    def __enter__(self) -> FakeVolume:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def put_file(self, local: Any, remote: str) -> None:
        data = local.read() if hasattr(local, "read") else Path(local).read_bytes()
        if remote.strip("/") != (self.drop or "").strip("/"):
            self.files[remote.strip("/")] = data

    def listdir(self, path: str, *, recursive: bool = False) -> list[Any]:
        prefix = path.strip("/")
        found = [
            SimpleNamespace(path=name, type=SimpleNamespace(name="FILE"), size=len(data))
            for name, data in sorted(self.files.items())
            if not prefix or name.startswith(prefix + "/")
        ]
        if prefix and not found:
            raise FileNotFoundError(path)
        return found

    def read_file(self, path: str) -> list[bytes]:
        return [self.files[path.strip("/")]]


def staged_capsule(synthetic: Synthetic) -> tuple[Path, staging.Manifest]:
    dest = synthetic.staged / UUID
    data_dir = staging.stage_capsule(
        synthetic.zip_path, dest, data_folder=staging.DATA_FOLDER_PREFIX + UUID
    )
    return data_dir, staging.verify_staged(dest)


def test_only_the_staged_data_files_are_uploaded_under_a_neutral_name(synthetic: Synthetic) -> None:
    data_dir, manifest = staged_capsule(synthetic)
    volume = FakeVolume()
    staged, uploaded = modal_stage.ensure_uploaded(volume, data_dir, manifest)
    assert uploaded and len(staged.key) == 32 and UUID not in staged.key
    names = sorted(volume.files)
    assert names == sorted(
        [f"{staged.key}/complete.json"] + [f"{staged.key}/data/{p}" for p in manifest.paths]
    )
    joined = "\n".join(names)
    for forbidden in (".ipynb", ".jsonl", "manifest", "CapsuleFolder", "Notebook", UUID, "syn-1"):
        assert forbidden not in joined
    everything = b"\n".join(volume.files.values())
    for sentinel in SENTINELS.values():  # no answer, hypothesis, paper link or notebook text
        assert sentinel.encode() not in everything
    assert modal_stage.audit_volume(volume) == []
    # A second call finds a complete, matching copy and uploads nothing.
    before = volume.uploads
    again, uploaded_again = modal_stage.ensure_uploaded(volume, data_dir, manifest)
    assert not uploaded_again and again == staged and volume.uploads == before


def test_the_listing_and_content_hashes_are_what_the_sandbox_computes(
    synthetic: Synthetic, tmp_path: Path
) -> None:
    data_dir, manifest = staged_capsule(synthetic)
    staged = modal_stage.describe(data_dir, manifest)
    listing = subprocess.run(
        f"cd {data_dir} && find . -type f | sed 's|^./||' | while read -r f; do "
        'printf "%s\\t%s\\n" "$f" "$(wc -c < "$f" | tr -d " ")"; done | LC_ALL=C sort | shasum -a 256',
        shell=True, capture_output=True, text=True, check=True,
    ).stdout.split()[0]  # fmt: skip
    content = subprocess.run(
        f"cd {data_dir} && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 | shasum -a 256",
        shell=True, capture_output=True, text=True, check=True,
    ).stdout.split()[0]  # fmt: skip
    assert (staged.listing_sha256, staged.content_sha256) == (listing, content)
    assert staged.files == len(manifest.paths)


def test_an_extra_file_a_link_or_a_changed_file_in_the_staged_folder_stops_the_upload(
    synthetic: Synthetic, tmp_path: Path
) -> None:
    data_dir, manifest = staged_capsule(synthetic)
    volume = FakeVolume()
    (data_dir / "solution.ipynb").write_text(SENTINELS["notebook"])
    with pytest.raises(staging.IntegrityError, match="manifest"):
        modal_stage.ensure_uploaded(volume, data_dir, manifest)
    (data_dir / "solution.ipynb").unlink()
    (data_dir / "answers.csv").symlink_to(synthetic.hub / "BixBench.jsonl")
    with pytest.raises(staging.IntegrityError, match="link"):
        modal_stage.ensure_uploaded(volume, data_dir, manifest)
    (data_dir / "answers.csv").unlink()
    (data_dir / "counts.csv").write_text("gene,a,b\n")
    with pytest.raises(staging.IntegrityError, match="size"):
        modal_stage.ensure_uploaded(volume, data_dir, manifest)
    assert volume.files == {} and volume.uploads == 0


def test_a_manifest_that_names_a_notebook_is_not_uploaded(synthetic: Synthetic) -> None:
    data_dir, manifest = staged_capsule(synthetic)
    (data_dir / "solution.ipynb").write_text("{}")
    manifest.included.append({"path": "solution.ipynb", "bytes": 2})
    staged = modal_stage.describe(data_dir, manifest)
    with pytest.raises(staging.IntegrityError, match="notebook"):
        modal_stage.plan_upload(data_dir, manifest, staged)


def test_an_upload_that_does_not_read_back_exactly_is_refused(synthetic: Synthetic) -> None:
    data_dir, manifest = staged_capsule(synthetic)
    staged = modal_stage.describe(data_dir, manifest)
    volume = FakeVolume()
    volume.drop = f"{staged.key}/data/counts.csv"
    with pytest.raises(staging.IntegrityError, match="exactly the staged files"):
        modal_stage.ensure_uploaded(volume, data_dir, manifest)
    assert f"{staged.key}/complete.json" not in volume.files  # never marked complete


def test_the_volume_audit_finds_what_must_never_be_there(synthetic: Synthetic) -> None:
    data_dir, manifest = staged_capsule(synthetic)
    volume = FakeVolume()
    staged, _ = modal_stage.ensure_uploaded(volume, data_dir, manifest)
    volume.files |= {
        "BixBench.jsonl": b"x",
        f"{staged.key}/data/solution.ipynb": b"x",
        f"{staged.key}/manifest.json": b"x",
        f"{staged.key}/data/CapsuleFolder-{UUID}.zip": b"x",
        f"{UUID}/data/counts.csv": b"x",
    }
    problems = modal_stage.audit_volume(volume)
    assert len(problems) == 5, problems


# The cost ledger ------------------------------------------------------------------------------------
def test_sandbox_cost_is_seconds_times_cores_and_gib_at_the_read_prices() -> None:
    # 4 cores and 16 GiB for one hour: 4 x 0.1419 + 16 x 0.024 = 0.9516 USD.
    assert modal_cost.sandbox_usd(3600, 4.0, 16384) == pytest.approx(0.9516)
    assert modal_cost.sandbox_usd(60, 2.0, 4096) == pytest.approx((2 * 0.1419 + 4 * 0.024) / 60)
    assert modal_cost.sandbox_usd(-5, 4.0, 16384) == 0.0
    # The most a swarm run can cost: two sandboxes, each alive until its timeout.
    assert modal_cost.worst_case_usd(3600, 4.0, 16384, 2) == pytest.approx(2 * 0.9516)


def test_a_ledger_line_is_readable_under_both_spellings_and_sums_per_writer(tmp_path: Path) -> None:
    ledger, total = tmp_path / "run" / "modal_ledger.jsonl", tmp_path / "all.jsonl"
    line = modal_cost.sandbox_line(
        seconds=100, cpu=4.0, memory_mib=16384, what="run ended", run="bix-1/single",
        capsule="bix-1", solver="single", sandbox_id="sb-1", app="a",
    )  # fmt: skip
    modal_cost.append([ledger, total], line)
    modal_cost.append([ledger], line | {"capsule": "bix-2"})
    with total.open("a") as fh:  # another writer's line, in the other spelling, and rubbish
        fh.write(json.dumps({"at": "t", "source": "gpu", "job": "modal-bench", "usd": 3.0}) + "\n")
        fh.write("not json\n[1, 2]\n")
    assert line["who"] == line["job"] == "modal-sandbox"
    assert line["kind"] == line["source"] == "sandbox" and line["ts"] == line["at"]
    assert line["usd"] == pytest.approx(100 * modal_cost.sandbox_rate(4.0, 16384), abs=1e-6)
    assert line["resource"] == {"cpu": 4.0, "memory_gib": 16.0, "gpu": None}
    assert len(modal_cost.read(ledger)) == 2 and len(modal_cost.read(total)) == 2
    assert modal_cost.spent(modal_cost.read(total)) == pytest.approx(line["usd"])  # ours only
    assert modal_cost.spent(modal_cost.read(total), who=None) == pytest.approx(line["usd"] + 3.0)
    assert modal_cost.spent(modal_cost.read(total), who="modal-bench") == pytest.approx(3.0)
    per = modal_cost.per_capsule(modal_cost.read(ledger))
    assert set(per) == {"bix-1", "bix-2"} and per["bix-1"]["sandboxes"] == 1
    assert per["bix-1"]["seconds"] == 100.0


def test_a_run_that_could_pass_the_cap_does_not_start(tmp_path: Path) -> None:
    ledger = tmp_path / "modal_ledger.jsonl"
    assert modal_cost.check_cap(ledger, 1.0, 0.9) == 0.0  # nothing spent, fits
    modal_cost.append(
        [ledger], modal_cost.sandbox_line(seconds=1, cpu=1, memory_mib=1024, what="x", usd=0.5)
    )
    assert modal_cost.check_cap(ledger, 1.0, 0.4) == pytest.approx(0.5)
    with pytest.raises(modal_cost.ModalCapReached, match=r"cap 1\.00"):
        modal_cost.check_cap(ledger, 1.0, 0.6)
    assert modal_cost.check_cap(ledger, None, 100.0) == pytest.approx(0.5)  # no cap given


# Provider selection ---------------------------------------------------------------------------------
QUESTION = {"question_id": "q1", "question": "What is 1 + 1?", "options": None}


def test_the_default_sandbox_is_still_local_docker() -> None:
    task = bixbench_v1(questions=[QUESTION], sample_id="s", compose_file="/tmp/compose.yaml")
    assert task.sandbox is not None
    assert (task.sandbox.type, task.sandbox.config) == ("docker", "/tmp/compose.yaml")
    assert bixbench_v1(questions=[QUESTION], sample_id="s").sandbox is None
    with pytest.raises(ValueError, match="not both"):
        bixbench_v1(
            questions=[QUESTION],
            sample_id="s",
            compose_file="/c.yaml",
            modal_config=CONFIG.model_dump(),
        )


def test_a_docker_run_imports_neither_modal_nor_the_provider() -> None:
    code = (
        "import sys; import bixbench_v1.cli, bixbench_v1.runner, bixbench_v1.task, bixbench_v1.solvers; "
        "bad = [m for m in sys.modules if m == 'modal' or m.startswith(('modal.', 'inspect_sandboxes'))]; "
        "print(bad); sys.exit(1 if bad else 0)"
    )
    done = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=False)
    assert done.returncode == 0, done.stdout + done.stderr
