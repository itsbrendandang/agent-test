"""The rules of a Modal sandbox for one run, as plain data and plain functions.

Nothing here imports Modal, so every rule is tested without the cloud and without the optional
packages (tests/modal_sandbox_boundary_test.py). `modal_sandbox.py` turns `sandbox_plan` into a
real `modal.Sandbox` and runs the probes inside it.

The rules, each the Modal form of a row of the README's integrity table:

  - no network: `block_network=True`, and never an open port, a tunnel or an allow-list;
  - nothing from the host but one capsule's staged data: one Volume, one sub-folder of it,
    read-only; no environment variables, no secrets, no Modal identity token;
  - a fixed size (CPU and memory: request = limit) and a wall-clock timeout, always;
  - what comes back from the sandbox (/outputs as a tar archive) is untrusted and is unpacked
    with `safe_extract`, which refuses anything but small regular files inside the target;
  - the analysis environment is the one in the repository: every sandbox of our image prints
    its conda packages, R packages and BUSCO layers (`FINGERPRINT`), and the run is refused
    unless their hashes equal `modal_env/expected-env.json` (`fingerprint_problems`).
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import tarfile
from pathlib import Path, PurePosixPath
from typing import Any

from pydantic import BaseModel, Field

RUN_TAG = "bixbench_v1_run"
CREATED_BY = {"created_by": "inspect-ai"}  # the tag `inspect sandbox cleanup modal` looks for
VOLUME_MOUNT = "/mnt/bix-staged"  # where the read-only Volume folder is attached
DATA_DIR = "/data"
OUTPUTS_DIR = "/outputs"
SETUP_SECONDS = 600  # added to a run's time limit for start-up, probes and the copy-out
MAX_TIMEOUT_SECONDS = 24 * 3600

# Sandbox.create arguments that would open the boundary. `sandbox_plan` never sets them and
# `check_create_kwargs` refuses them, whoever built the arguments.
FORBIDDEN_KWARGS = (
    "env",
    "secrets",
    "encrypted_ports",
    "h2_ports",
    "unencrypted_ports",
    "outbound_cidr_allowlist",
    "outbound_domain_allowlist",
    "inbound_cidr_allowlist",
    "cidr_allowlist",
    "proxy",
    "network_file_systems",
    "include_oidc_identity_token",
    "gpu",
    "_experimental_outbound_policy",
)


# Variables Modal puts into every container (seen with `env` in a sandbox of our image,
# 2026-11-15). The official image, run by Docker, has none of them, and two change what code
# does: PYTHONHASHSEED=0 fixes Python's hash order and PYTHONPATH puts /pkg and /root on
# sys.path. Every command the provider runs is started through `env -u ...` for these names,
# and so are the tool helper and the shells it starts.
MODAL_ADDED_ENV = (
    "PYTHONHASHSEED",
    "PYTHONPATH",
    "SOURCE_DATE_EPOCH",
    "PIP_DEFAULT_TIMEOUT",
    "PIP_NO_CACHE_DIR",
    "PIP_ROOT_USER_ACTION",
    "UV_BREAK_SYSTEM_PACKAGES",
    "SSL_CERT_DIR",
    "CFLAGS",
    "TERM",
    "MODAL_CLOUD_PROVIDER",
    "MODAL_CONTAINER_ARGUMENTS_PATH",
    "MODAL_IMAGE_ID",
    "MODAL_REGION",
    "MODAL_SANDBOX_ID",
    "MODAL_TASK_ID",
)


def clean_env_command(cmd: list[str], env: dict[str, str] | None = None) -> list[str]:
    """`cmd`, started without the variables Modal adds (one the caller sets itself is kept)."""
    drop = [name for name in MODAL_ADDED_ENV if not (env and name in env)]
    return ["/usr/bin/env", *[part for name in drop for part in ("-u", name)], *cmd]


class FreshSandbox:
    """A sandbox environment that can replace itself with a new, empty sandbox.

    The swarm's critic must see nothing of the analyst's. In one container that is done by
    killing, moving and checking (solvers.blind_check). A provider that can instead start a
    second sandbox from the same image and data gives a stronger guarantee: the analyst's
    files, processes and kernel objects are in another machine's memory, or gone. A provider
    with this ability inherits from this class and solvers.blind_check uses it when present.

    `keep` names paths whose files are carried over on the HOST (never into the new sandbox)
    and added to the run's outputs at the end."""

    async def fresh_sandbox(self, keep: list[str]) -> None:
        raise NotImplementedError


class BixModalConfig(BaseModel, frozen=True):
    """Everything a Modal sandbox of one run is made from. Written to the eval log: it holds
    no secret, no host path and no capsule name (the data path is a content hash)."""

    run_tag: str = Field(pattern=r"^[0-9a-f]{16,64}$")
    image: str
    app: str
    volume: str
    data_path: str = Field(pattern=r"^/[0-9a-f]{32}/data$")
    files: int = Field(ge=1)
    listing_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    timeout_seconds: int = Field(ge=60, le=MAX_TIMEOUT_SECONDS)
    cpu: float = Field(default=4.0, gt=0, le=64)
    memory_mib: int = Field(default=16384, ge=512, le=262144)


def sandbox_timeout(time_limit_seconds: int, backstop_seconds: int) -> int:
    """Lifetime of one sandbox: the run's time limit, Inspect's backstop, and start-up."""
    return min(MAX_TIMEOUT_SECONDS, time_limit_seconds + backstop_seconds + SETUP_SECONDS)


def sandbox_plan(config: BixModalConfig) -> dict[str, Any]:
    """The arguments of `modal.Sandbox.create` for this run, as plain values.

    `image` and `volume` are names here; modal_sandbox.py replaces them with Modal objects.
    Every sandbox of a run is made from this one plan, the critic's fresh one included."""
    return {
        "command": ["sleep", "infinity"],
        "image": config.image,
        "app": config.app,
        "workdir": "/home",
        "block_network": True,
        "cpu": (config.cpu, config.cpu),  # request, limit
        "memory": (config.memory_mib, config.memory_mib),
        "timeout": config.timeout_seconds,
        "tags": {**CREATED_BY, RUN_TAG: config.run_tag},
        "volume": {
            "name": config.volume,
            "mount": VOLUME_MOUNT,
            "sub_path": config.data_path,
            "read_only": True,
        },
    }


def check_create_kwargs(kwargs: dict[str, Any]) -> None:
    """Last look at the real `Sandbox.create` arguments. Raises on anything that would give
    the sandbox a network, a secret, more than the one data mount, or no limits."""
    for name in FORBIDDEN_KWARGS:
        if kwargs.get(name):
            raise ValueError(f"a BixBench sandbox must not be created with {name}")
    if kwargs.get("block_network") is not True:
        raise ValueError("a BixBench sandbox must be created with block_network=True")
    if list(kwargs.get("volumes", {})) != [VOLUME_MOUNT]:
        raise ValueError(f"a BixBench sandbox mounts exactly one Volume, at {VOLUME_MOUNT}")
    timeout = kwargs.get("timeout")
    if not isinstance(timeout, int) or not 0 < timeout <= MAX_TIMEOUT_SECONDS:
        raise ValueError("a BixBench sandbox needs a wall-clock timeout")
    for name in ("cpu", "memory"):
        value = kwargs.get(name)
        if not (
            isinstance(value, tuple) and len(value) == 2 and value[0] == value[1] and value[1] > 0
        ):
            raise ValueError(f"a BixBench sandbox needs a {name} limit (request, limit)")


# Scripts run inside the sandbox ------------------------------------------------------------------
# As root, once, when a sandbox starts. The Volume folder is attached read-only at VOLUME_MOUNT
# (Modal makes that path a symbolic link into /__modal/volumes). The files are copied to a real
# /data directory, owned by root and not writable, because a symbolic link at /data would change
# what ordinary commands print (`find /data -type f` prints nothing through a link). Then the
# link is removed and /__modal is closed to other users, so the role users see one copy.
PLACE_DATA = f"""
set -e
mkdir -p {DATA_DIR} {OUTPUTS_DIR}
cp -a {VOLUME_MOUNT}/. {DATA_DIR}/
chown -R root:root {DATA_DIR}
chmod -R a-w,a+rX {DATA_DIR}
rm -f {VOLUME_MOUNT}
chmod 700 /__modal 2>/dev/null || true
"""

# Prints one JSON object. Everything in "reached" and "secret_names" must be empty, and the two
# hashes must equal the host's. Run as root; python3 is in every image we use.
PROBE = r"""
import hashlib, json, os, re, socket, subprocess, urllib.request
out = {"reached": [], "secret_names": [], "forbidden_files": []}
for host, port in (("1.1.1.1", 443), ("8.8.8.8", 53), ("api.anthropic.com", 443),
                   ("api.openai.com", 443), ("pypi.org", 443), ("169.254.169.254", 80)):
    s = socket.socket(); s.settimeout(4)
    try:
        s.connect((host, port)); out["reached"].append(f"tcp {host}:{port}")
    except OSError:
        pass
    finally:
        s.close()
for name in ("api.anthropic.com", "pypi.org", "huggingface.co"):
    try:
        socket.getaddrinfo(name, 443); out["reached"].append(f"dns {name}")
    except OSError:
        pass
try:
    u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); u.settimeout(3)
    u.sendto(b"\x12\x34\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00\x07example\x03com\x00\x00\x01\x00\x01", ("8.8.8.8", 53))
    u.recvfrom(512); out["reached"].append("udp 8.8.8.8:53")
except OSError:
    pass
try:
    urllib.request.urlopen("https://pypi.org/simple/", timeout=4); out["reached"].append("https pypi.org")
except Exception:
    pass
pattern = re.compile(r"(API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)|^(ANTHROPIC|OPENAI|EXA|PAST|HF|HUGGING|AWS|GOOGLE|GCP|AZURE|TINKER|OPENROUTER)_", re.I)
names = set(os.environ)
try:
    with open("/proc/1/environ", "rb") as fh:
        names |= {item.split(b"=", 1)[0].decode("utf-8", "replace") for item in fh.read().split(b"\0") if item}
except OSError:
    pass
out["secret_names"] = sorted(n for n in names if pattern.search(n))
roots = [d for d in ("/data", "/outputs", "/home", "/root", "/tmp", "/var/tmp", "/dev/shm", "/mnt", "/workspace", "/envs", "/srv", "/media") if os.path.isdir(d)]
found = subprocess.run(
    ["find", *roots, "-xdev", "(", "-name", ".env", "-o", "-name", ".modal.toml", "-o", "-name", "BixBench.jsonl",
     "-o", "-name", "CapsuleFolder-*", "-o", "-name", "shuffle_salt.json", "-o", "-name", "grade.json",
     "-o", "-name", "run.json", "-o", "-name", "manifest.json", "-o", "-name", "*.ipynb", ")", "-print"],
    capture_output=True, text=True).stdout.split("\n")
out["forbidden_files"] = [f for f in found if f][:20]
listing = subprocess.run("find /data -type f -printf '%P\\t%s\\n' | LC_ALL=C sort", shell=True, capture_output=True).stdout
content = subprocess.run("cd /data && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum", shell=True, capture_output=True).stdout
out["files"] = listing.count(b"\n")
out["listing_sha256"] = hashlib.sha256(listing).hexdigest()
out["content_sha256"] = hashlib.sha256(content).hexdigest()
out["not_regular"] = subprocess.run("find /data -mindepth 1 ! -type f ! -type d | head -5", shell=True, capture_output=True, text=True).stdout.split()
w = subprocess.run(["su", "-s", "/bin/sh", "nobody", "-c", "touch /data/.bix-write-probe"], capture_output=True)
out["data_writable_by_others"] = w.returncode == 0
out["volume_visible_to_others"] = subprocess.run(["su", "-s", "/bin/sh", "nobody", "-c", "ls /__modal/volumes"], capture_output=True).returncode == 0
out["machine"] = os.uname().machine
out["kernel"] = os.uname().release
print(json.dumps(out))
"""


def probe_problems(result: dict[str, Any], config: BixModalConfig) -> list[str]:
    """What a probe result says is wrong (empty = the sandbox may be used)."""
    problems: list[str] = []
    if result.get("reached"):
        problems.append(f"the sandbox reached the network: {result['reached'][:5]}")
    if result.get("secret_names"):
        problems.append(f"secret-like environment variables: {result['secret_names'][:5]}")
    if result.get("forbidden_files"):
        problems.append(f"files that must not be in a sandbox: {result['forbidden_files'][:5]}")
    if result.get("not_regular"):
        problems.append(f"/data holds something that is not a file: {result['not_regular'][:5]}")
    if result.get("files") != config.files or result.get("listing_sha256") != config.listing_sha256:
        problems.append(
            f"/data is not the staged file list ({result.get('files')} files, {config.files} expected)"
        )
    elif result.get("content_sha256") != config.content_sha256:
        problems.append("/data has the staged file names and sizes but other contents")
    if result.get("data_writable_by_others") is not False:
        problems.append("/data is writable by a non-root user")
    if result.get("volume_visible_to_others") is not False:
        problems.append("the mounted Volume is visible to a non-root user")
    return problems


def parse_probe(stdout: str) -> dict[str, Any]:
    """The probe's one JSON line. Anything else is a failed probe, never a pass."""
    for line in reversed(stdout.strip().splitlines()):
        try:
            document = json.loads(line)
        except ValueError:
            continue
        if isinstance(document, dict):
            return document
    raise ValueError("the sandbox probe printed no result")


# The analysis environment -----------------------------------------------------------------------
# What a sandbox of our image must hold, as hashes. Derived from the committed inventory
# (image/amd64-modal.inventory.json) by `python -m bixbench_v1.modal_image fingerprint`; never
# edited by hand. A rebuild on any Modal account must give the same hashes, or no run starts.
EXPECTED_ENV_FILE = Path(__file__).resolve().parent / "modal_env" / "expected-env.json"
# Images under this name are checked. Another image (`--image`) is recorded, not checked.
CHECKED_IMAGE_PREFIX = "bixbench-v1-env:"

# Prints one JSON object with the raw lists; the host hashes them (`fingerprint`), with the same
# code that hashes the committed inventory. The commands are those of image/tools/inventory.py.
FINGERPRINT = r"""
import json, subprocess
def sh(cmd, timeout=600):
    r = subprocess.run(["bash", "-c", cmd], capture_output=True, text=True, timeout=timeout)
    return r.stdout, r.returncode
out = {"errors": []}
text, code = sh("conda list --json")
try:
    out["conda"] = [[p["name"], p["version"], p.get("build_string")] for p in json.loads(text)]
except Exception as e:
    out["errors"].append(f"conda list: exit {code}: {type(e).__name__}")
text, code = sh("Rscript -e 'ip <- installed.packages(); cat(\"RVERSION\\t\", R.version.string, \"\\n\", sep=\"\"); for (i in seq_len(nrow(ip))) cat(\"PKG\\t\", ip[i, \"Package\"], \"\\t\", ip[i, \"Version\"], \"\\n\", sep=\"\")'")
out["r"] = [line.split("\t")[1:3] for line in text.splitlines() if line.startswith("PKG\t")]
out["r_version"] = next((line.split("\t", 1)[1] for line in text.splitlines() if line.startswith("RVERSION\t")), None)
if code != 0 or not out["r"]:
    out["errors"].append(f"Rscript: exit {code}")
text, _ = sh("find /root/.udocker/layers -type f -o -type l 2>/dev/null | sed 's|.*/||' | sort")
out["busco_layers"] = [line for line in text.splitlines() if line]
print(json.dumps(out))
"""


def _digest(lines: list[str]) -> dict[str, Any]:
    ordered = sorted(lines)
    return {
        "count": len(ordered),
        "sha256": hashlib.sha256("\n".join(ordered).encode()).hexdigest(),
    }


def fingerprint(
    conda: list[tuple[str, str, str | None]],
    r_packages: list[tuple[str, str]],
    r_version: str | None,
    busco_layers: list[str],
) -> dict[str, Any]:
    """The hashes that identify the analysis environment: every conda package (name, version,
    build), every R package (name, version; R's own and Bioconductor's included), the R version
    and the BUSCO image's layers (udocker stores them by sha256)."""
    return {
        "conda": _digest([f"{n}={v}={b}" for n, v, b in conda]),
        "r": _digest([f"{n}={v}" for n, v in r_packages]) | {"version": r_version},
        "busco_layers": _digest(busco_layers),
    }


def fingerprint_of_inventory(inventory: dict[str, Any]) -> dict[str, Any]:
    """The fingerprint of a committed inventory (image/tools/inventory.py's output)."""
    return fingerprint(
        [(p["name"], p["version"], p.get("build")) for p in inventory["conda"]],
        [(p["name"], p["version"]) for p in inventory["r"]["packages"]],
        inventory["r"].get("rversion"),
        list(inventory.get("udocker_layers") or []),
    )


def fingerprint_of_sandbox(printed: dict[str, Any]) -> dict[str, Any]:
    """The fingerprint of what `FINGERPRINT` printed in a sandbox."""
    return fingerprint(
        [(n, v, b) for n, v, b in printed.get("conda") or []],
        [(n, v) for n, v in printed.get("r") or []],
        printed.get("r_version"),
        list(printed.get("busco_layers") or []),
    )


def expected_env(path: Path = EXPECTED_ENV_FILE) -> dict[str, Any]:
    document: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return document


def checks_environment(image: str) -> bool:
    return image.startswith(CHECKED_IMAGE_PREFIX)


def fingerprint_problems(printed: dict[str, Any], expected: dict[str, Any]) -> list[str]:
    """What differs between a sandbox's environment and the repository's (empty = the same)."""
    problems = [f"the environment could not be read: {e}" for e in printed.get("errors") or []]
    found = fingerprint_of_sandbox(printed)
    names = {"conda": "conda packages", "r": "R packages", "busco_layers": "BUSCO image layers"}
    for part, name in names.items():
        want, got = expected[part], found[part]
        if want != got:
            problems.append(
                f"{name} differ from modal_env/expected-env.json "
                f"({got.get('count')} found, {want.get('count')} expected)"
            )
    return problems


# Copy-out ----------------------------------------------------------------------------------------
MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
MAX_MEMBERS = 5000
_SAFE_PART = re.compile(r"^[^\x00-\x1f\\]+$")
# One exec, as root: /outputs as a gzipped tar on a file the client then reads through the file
# API. `--no-recursion` is not used: /outputs is written by our own code and the role users.
ARCHIVE_COMMAND = (
    "set -e; rm -f /tmp/.bix-outputs.tgz; "
    "tar -C {source} -czf /tmp/.bix-outputs.tgz --exclude='./.bix-*' . ; "
    "stat -c %s /tmp/.bix-outputs.tgz"
)
ARCHIVE_PATH = "/tmp/.bix-outputs.tgz"


class UnsafeArchive(RuntimeError):
    """The sandbox returned an archive we will not unpack."""


def safe_members(payload: bytes) -> list[tuple[str, bytes]]:
    """(relative path, bytes) of every regular file in a gzipped tar from the sandbox.

    The sandbox is untrusted: the archive is read in memory and nothing is written by tarfile
    itself. Refused: more than 50 MB or 5,000 members, an absolute path, `..`, a link, a device,
    a fifo, a control character in a name. Directories are skipped (they are made as needed)."""
    if len(payload) > MAX_ARCHIVE_BYTES:
        raise UnsafeArchive(f"outputs archive is {len(payload):,} bytes; the limit is 50 MB")
    files: list[tuple[str, bytes]] = []
    total = 0
    try:
        archive = tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz")
    except (tarfile.TarError, OSError, EOFError) as error:
        raise UnsafeArchive(f"outputs archive is unreadable: {error}") from error
    with archive:
        for count, member in enumerate(archive):
            if count >= MAX_MEMBERS:
                raise UnsafeArchive("outputs archive has too many members")
            path = PurePosixPath(member.name)
            parts = [p for p in path.parts if p not in (".", "")]
            if member.isdir():
                continue
            if not member.isfile():
                raise UnsafeArchive(f"outputs archive holds a link or a device: {member.name!r}")
            if path.is_absolute() or ".." in parts or not parts:
                raise UnsafeArchive(f"outputs archive holds an unsafe path: {member.name!r}")
            if not all(_SAFE_PART.match(p) for p in parts):
                raise UnsafeArchive(f"outputs archive holds an unsafe name: {member.name!r}")
            total += member.size
            if total > MAX_ARCHIVE_BYTES:
                raise UnsafeArchive("outputs archive unpacks to more than 50 MB")
            handle = archive.extractfile(member)
            files.append(("/".join(parts), handle.read() if handle is not None else b""))
    return files


def write_members(files: list[tuple[str, bytes]], dest: Path, overwrite: bool = True) -> int:
    """Write (relative path, bytes) pairs under `dest`. Every target is resolved and must stay
    inside `dest`; an existing symbolic link on the way is refused. Returns files written."""
    root = dest.resolve()
    root.mkdir(parents=True, exist_ok=True)
    written = 0
    for relative, data in files:
        target = (root / relative).resolve()
        if root != target and root not in target.parents:
            raise UnsafeArchive(f"refusing to write outside the outputs folder: {relative!r}")
        if target.exists() and not overwrite:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.is_symlink() or target.is_dir():
            raise UnsafeArchive(f"refusing to replace a link or a folder: {relative!r}")
        target.write_bytes(data)
        written += 1
    return written
