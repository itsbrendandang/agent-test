"""The analysis image for `--sandbox modal`: an amd64 rebuild of the official BixBench image.

The official image `futurehouse/bixbench:aviary-notebook-env` exists for linux/arm64 only and
Modal runs linux/amd64 only, so it cannot be pulled there. This module defines, as a Modal
Image in code, the closest amd64 image we could make:

  - the same base image tag (`continuumio/miniconda3:24.9.2-0`, Debian 12), amd64 variant;
  - the same four apt packages, installed from Debian's snapshot archive of the day the
    official image was built, so the package versions are that day's;
  - every one of the 843 conda packages of the official image at the same version, as an
    explicit list (`modal_env/explicit-linux-64.txt`: no solver runs, so nothing can drift);
    the list was made from the official image's own `conda list --explicit` by
    `image/tools/mapenv.py`;
  - the same two Jupyter kernels, the same `requirements.txt`, the same udocker BUSCO image.

It is NOT the official image. What differs is listed, by package name, in `image/diff.json`
and `image/DIFF.md` (made by `python -m bixbench_v1.modal_image diff`). A score from a run in
this image is not comparable with published BixBench numbers or with a local Docker run.

    uv run --group modal python -m bixbench_v1.modal_image build      # build and publish (billed)
    uv run --group modal python -m bixbench_v1.modal_image inventory  # list what is in it (billed)
    uv run python -m bixbench_v1.modal_image diff                     # compare inventories (free)
    uv run --group modal python -m bixbench_v1.modal_image equivalence          # fixed analysis (billed)
    uv run python -m bixbench_v1.modal_image compare-equivalence      # compare its results (free)

`build` and `inventory` use Modal and are refused while NO_PAID_CALLS is on.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any

from . import modal_boundary, paid
from .modal_boundary import MODAL_ADDED_ENV, clean_env_command

if TYPE_CHECKING:  # the `modal` package is in the optional dependency group "modal"
    import modal

APP_NAME = "bixbench-v1-sandbox"
IMAGE_NAME = "bixbench-v1-env"
IMAGE_TAG = "amd64-1"
PUBLISHED = f"{IMAGE_NAME}:{IMAGE_TAG}"
# Modal's image builder version (`modal config`, MODAL_IMAGE_BUILDER_VERSION) changes how each
# step is built; without a pin a build uses the workspace's default, which differs between
# accounts. `build` sets this one. The contents are checked anyway (modal_env/expected-env.json).
IMAGE_BUILDER_VERSION = "2025.06"
OFFICIAL_IMAGE = "futurehouse/bixbench:aviary-notebook-env"

# The official image's base, by tag and by the digest of the multi-platform index.
BASE_IMAGE = (
    "continuumio/miniconda3:24.9.2-0"
    "@sha256:15f887d74b3ffe0fa21a741bfeaec8ccc8947b527acfb7542eff84ae1bfdd6bf"
)
# The official image's apt layer was built around 2024-12-30 (the dates of the files it wrote;
# the image's last layer is from 2025-01-18). With the snapshot of 2025-01-18, 22 Debian
# packages came out one point release newer than the official ones; with this date they match.
APT_SNAPSHOT = "20241230T000000Z"
BUSCO_IMAGE = "ezlabgva/busco:v5.8.0_cv1"

ENV_DIR = Path(__file__).parent / "modal_env"
EXPLICIT = ENV_DIR / "explicit-linux-64.txt"
REQUIREMENTS = ENV_DIR / "requirements.txt"
FINISH = ENV_DIR / "finish_env.py"
EVIDENCE = Path(__file__).resolve().parents[2] / "image"  # glhf/bixbench_v1/image

_SNAPSHOT_SOURCES = (
    f"deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/{APT_SNAPSHOT} bookworm main\\n"
    f"deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/{APT_SNAPSHOT} bookworm-updates main\\n"
    f"deb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/{APT_SNAPSHOT} bookworm-security main\\n"
)
# The official layer is `apt-get update && apt-get install -yq --no-install-recommends wget gpg
# software-properties-common build-essential && rm -rf /var/lib/apt/lists/*`. Here the same
# command reads Debian's archive as it was on the day of the official build; the image's own
# sources file is put back afterwards, so the image is left configured as the official one.
APT_STEP = (
    "set -e; mkdir -p /tmp/bix-apt && mv /etc/apt/sources.list.d/* /tmp/bix-apt/ 2>/dev/null || true; "
    f"printf '{_SNAPSHOT_SOURCES}' > /etc/apt/sources.list; "
    "apt-get -o Acquire::Check-Valid-Until=false -o Acquire::Retries=5 update && "
    "apt-get install -yq --no-install-recommends wget gpg software-properties-common build-essential && "
    "rm -rf /var/lib/apt/lists/* /etc/apt/sources.list && "
    "mv /tmp/bix-apt/* /etc/apt/sources.list.d/ 2>/dev/null || true; rmdir /tmp/bix-apt"
)
CONDA_STEP = (
    "set -e; conda install -n base -y -q --file /tmp/bix-build/explicit-linux-64.txt && "
    "python /tmp/bix-build/finish_env.py /tmp/bix-build/explicit-linux-64.txt"
)


def definition() -> modal.Image:
    """The image, step by step in the order of the official image's build history
    (`docker history`, kept in image/arm64-official.history.txt)."""
    import modal

    return (
        modal.Image.from_registry(BASE_IMAGE)  # no add_python: nothing is installed for Modal
        .run_commands("mkdir /workspace && mkdir /envs")
        .workdir("/envs")
        .env({"DEBIAN_FRONTEND": "noninteractive"})
        .run_commands(APT_STEP)
        # Official: conda install mamba, then three `mamba install` steps (R, bioinformatics
        # tools, requirements.txt). Here: their result, as one explicit list.
        .add_local_file(EXPLICIT, "/tmp/bix-build/explicit-linux-64.txt", copy=True)
        .add_local_file(FINISH, "/tmp/bix-build/finish_env.py", copy=True)
        .run_commands(CONDA_STEP, "rm -rf /tmp/bix-build")
        .run_commands(
            'python -m ipykernel install --user --name python3 --display-name "Python 3 (ipykernel)"',
            'R -e \'IRkernel::installspec(name = "R", displayname = "R (4.3.3)")\'',
        )
        .add_local_file(REQUIREMENTS, "/envs/requirements.txt", copy=True)
        .run_commands(f"udocker --allow-root install && udocker --allow-root pull {BUSCO_IMAGE}")
        .workdir("/workspace")
        .run_commands(
            "mamba clean --all -f -y && conda clean --all -f -y && rm -rf /root/.cache/pip"
        )
    )


def build(publish: bool = True) -> str:
    """Build the image on Modal and publish it as `bixbench-v1-env:amd64-1`. Returns its id."""
    paid.refuse_modal(f"building the sandbox image {PUBLISHED}")
    chosen = os.environ.get("MODAL_IMAGE_BUILDER_VERSION")
    if chosen not in (None, IMAGE_BUILDER_VERSION):
        sys.exit(
            f"MODAL_IMAGE_BUILDER_VERSION is {chosen}; this image is built with "
            f"{IMAGE_BUILDER_VERSION} (modal_image.IMAGE_BUILDER_VERSION). Unset it, or change "
            "the constant and check the result with `verify`."
        )
    os.environ["MODAL_IMAGE_BUILDER_VERSION"] = IMAGE_BUILDER_VERSION  # read by Modal at build
    import modal

    app = modal.App.lookup(APP_NAME, create_if_missing=True)
    image = definition()
    with modal.enable_output():
        image.build(app)
    if publish:
        image.publish(PUBLISHED)
    return str(image.object_id)


def inventory(
    image_name: str = PUBLISHED, cpu: float = 2.0, memory_mib: int = 4096
) -> dict[str, Any]:
    """Run image/tools/inventory.py in a network-blocked Modal sandbox of the image."""
    paid.refuse_modal(f"an inventory sandbox of {image_name}")
    import modal

    script = (EVIDENCE / "tools" / "inventory.py").read_text(encoding="utf-8")
    app = modal.App.lookup(APP_NAME, create_if_missing=True)
    image = modal.Image.from_name(image_name)
    sandbox = modal.Sandbox.create(
        "sleep", "infinity", app=app, image=image, timeout=900, cpu=cpu, memory=memory_mib,
        block_network=True,
    )  # fmt: skip
    try:
        sandbox.filesystem.write_text(script, "/tmp/inventory.py")
        process = sandbox.exec("python", "/tmp/inventory.py")
        out = process.stdout.read()
        process.wait()
        document: dict[str, Any] = json.loads(out)
        document["modal_image"] = {"name": image_name, "id": image.object_id}
        return document
    finally:
        sandbox.terminate()


def write_fingerprint(
    inventory_file: Path | None = None, target: Path = modal_boundary.EXPECTED_ENV_FILE
) -> dict[str, Any]:
    """modal_env/expected-env.json from the committed inventory. Free: reads one file."""
    source = inventory_file or EVIDENCE / "amd64-modal.inventory.json"
    document = json.loads(source.read_text())
    expected = {
        "about": (
            "What a sandbox of our image must hold, as hashes. Made by `python -m "
            "bixbench_v1.modal_image fingerprint` from image/amd64-modal.inventory.json; do not "
            "edit. Every Modal run checks it (modal_boundary.fingerprint_problems)."
        ),
        "image": document["modal_image"]["name"],
        "image_id_when_made": document["modal_image"]["id"],
        **modal_boundary.fingerprint_of_inventory(document),
    }
    target.write_text(json.dumps(expected, indent=1) + "\n")
    return expected


def verify(image_name: str = PUBLISHED) -> list[str]:
    """Inventory a published image (billed: one small sandbox for a few minutes) and compare its
    fingerprint with the repository's. Empty = the same environment. Run it after every build,
    on any account: the image id differs between builds, the contents must not."""
    document = inventory(image_name)
    found = modal_boundary.fingerprint_of_inventory(document)
    expected = modal_boundary.expected_env()
    problems = []
    names = {"conda": "conda packages", "r": "R packages", "busco_layers": "BUSCO image layers"}
    for part, name in names.items():
        if found[part] != expected[part]:
            problems.append(f"{name}: found {found[part]}, expected {expected[part]}")
    print(f"{image_name} ({document['modal_image']['id']}):")
    for part, name in names.items():
        mark = "same" if found[part] == expected[part] else "DIFFERENT"
        print(f"  {name:20} {found[part]['count']:4}  {mark}")
    if problems:
        target = EVIDENCE / f"verify-{image_name.replace(':', '-')}.inventory.json"
        target.write_text(json.dumps(document, indent=1, sort_keys=True) + "\n")
        print(f"wrote {target}: diff it with amd64-modal.inventory.json")
    return problems


def equivalence(
    image_name: str = PUBLISHED, cpu: float = 4.0, memory_mib: int = 8192
) -> dict[str, Any]:
    """Run image/tools/equivalence.py (a fixed analysis, no model, no data from outside) in a
    network-blocked Modal sandbox of the image, started as the provider starts commands."""
    paid.refuse_modal(f"an equivalence sandbox of {image_name}")
    import modal

    script = (EVIDENCE / "tools" / "equivalence.py").read_text(encoding="utf-8")
    app = modal.App.lookup(APP_NAME, create_if_missing=True)
    sandbox = modal.Sandbox.create(
        "sleep", "infinity", app=app, image=modal.Image.from_name(image_name), timeout=1200,
        cpu=(cpu, cpu), memory=(memory_mib, memory_mib), block_network=True,
    )  # fmt: skip
    try:
        sandbox.filesystem.write_text(script, "/tmp/equivalence.py")
        process = sandbox.exec(*clean_env_command(["python", "/tmp/equivalence.py"]))
        out = process.stdout.read()
        process.wait()
        document: dict[str, Any] = json.loads(out)
        return document
    finally:
        sandbox.terminate()


def _leaves(value: Any, path: str = "") -> list[tuple[str, Any]]:
    if isinstance(value, dict):
        return [leaf for k, v in value.items() for leaf in _leaves(v, f"{path}.{k}" if path else k)]
    if isinstance(value, list):
        return [leaf for i, v in enumerate(value) for leaf in _leaves(v, f"{path}[{i}]")]
    return [(path, value)]


def compare_equivalence(official: dict[str, Any], ours: dict[str, Any]) -> dict[str, Any]:
    """Every value of the fixed analysis, official image against Modal image. A number is
    compared by relative difference and reported as the count of leading significant digits
    that agree (17 = the same double); text and integers must be equal."""
    a = dict(_leaves({k: v for k, v in official["results"].items() if k != "versions"}))
    b = dict(_leaves({k: v for k, v in ours["results"].items() if k != "versions"}))
    rows: list[dict[str, Any]] = []
    for name in sorted(set(a) | set(b)):
        x, y = a.get(name), b.get(name)
        row: dict[str, Any] = {"name": name, "official": x, "modal": y}
        numeric = all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (x, y))
        if numeric and (isinstance(x, float) or isinstance(y, float)):
            fx, fy = float(x), float(y)  # type: ignore[arg-type]
            if fx == fy or (math.isnan(fx) and math.isnan(fy)):
                row |= {"same": True, "digits": 17, "relative_difference": 0.0}
            else:
                relative = abs(fx - fy) / max(abs(fx), abs(fy))
                row |= {
                    "same": False,
                    "digits": max(0, min(17, math.floor(-math.log10(relative)))),
                    "relative_difference": relative,
                }
        else:
            row |= {"same": x == y, "digits": None}
        rows.append(row)
    sections: dict[str, dict[str, Any]] = {}
    for row in rows:
        section = (
            row["name"].split(".")[0]
            if not row["name"].startswith("r.")
            else "r." + row["name"].split(".")[1]
        )
        cell = sections.setdefault(
            section,
            {
                "values": 0,
                "identical": 0,
                "text_or_integer_differs": [],
                "fewest_digits": 17,
                "worst": None,
            },
        )
        cell["values"] += 1
        cell["identical"] += int(bool(row["same"]))
        if row["digits"] is None and not row["same"]:
            cell["text_or_integer_differs"].append(row["name"])
        if row["digits"] is not None and row["digits"] < cell["fewest_digits"]:
            cell["fewest_digits"], cell["worst"] = row["digits"], row["name"]
    numeric_rows = [r for r in rows if r["digits"] is not None]
    return {
        "official": official["results"].get("versions"),
        "modal": ours["results"].get("versions"),
        "errors": {"official": official.get("errors"), "modal": ours.get("errors")},
        "values": len(rows),
        "identical": sum(1 for r in rows if r["same"]),
        "numbers": len(numeric_rows),
        "numbers_identical_to_the_last_bit": sum(1 for r in numeric_rows if r["same"]),
        "fewest_agreeing_digits": min((r["digits"] for r in numeric_rows), default=None),
        "text_or_integer_differs": [
            r["name"] for r in rows if r["digits"] is None and not r["same"]
        ],
        "sections": sections,
        "differing_values": [r for r in rows if not r["same"]],
    }


def equivalence_markdown(d: dict[str, Any]) -> str:
    lines = [
        "# The same fixed analysis in the official image and in the Modal image",
        "",
        "Made by `python -m bixbench_v1.modal_image compare-equivalence` from the two result files in",
        "this folder (`equivalence.arm64-official.json`, `equivalence.amd64-modal.json`). The script is",
        "`tools/equivalence.py`: seeded synthetic data, no model, no network, one thread.",
        "",
        f"- Official: {d['official']}",
        f"- Modal: {d['modal']}",
        f"- Errors: official {d['errors']['official'] or 'none'}, Modal {d['errors']['modal'] or 'none'}",
        f"- Values compared: {d['values']}; identical: {d['identical']}",
        f"- Numbers: {d['numbers']}; identical to the last bit: {d['numbers_identical_to_the_last_bit']}; "
        f"fewest agreeing significant digits in any number: {d['fewest_agreeing_digits']}",
        f"- Text or integer values that differ: {d['text_or_integer_differs'] or 'none'}",
        "",
        "A double holds 15 to 17 significant digits. Two CPU architectures use different compiled",
        "kernels (OpenBLAS, libm, fused multiply-add), so the last one to three digits of a direct",
        "calculation can differ; an iterative fit stops at its tolerance and agrees to fewer.",
        "scanpy computes in single precision (float32, about 7 significant digits), so its numbers",
        "can agree to 7 digits at most.",
        "",
        "| section | values | identical | fewest agreeing digits | where |",
        "|---|---|---|---|---|",
    ]
    for name, cell in d["sections"].items():
        lines.append(
            f"| {name} | {cell['values']} | {cell['identical']} | "
            f"{cell['fewest_digits'] if cell['worst'] else 'all identical'} | {cell['worst'] or ''} |"
        )
    lines += [
        "",
        "## Every value that differs",
        "",
        "| value | official | Modal | agreeing digits |",
        "|---|---|---|---|",
    ]
    for row in d["differing_values"]:
        lines.append(
            f"| {row['name']} | {row['official']!r} | {row['modal']!r} | {row['digits']} |"
        )
    return "\n".join(lines) + "\n"


# Comparing two inventories ---------------------------------------------------------------------
def _versions(rows: list[dict[str, Any]], *fields: str) -> dict[str, tuple[str, ...]]:
    return {str(r["name"]): tuple(str(r.get(f)) for f in fields) for r in rows}


def _section(
    official: dict[str, tuple[str, ...]], ours: dict[str, tuple[str, ...]], compare: int
) -> dict[str, Any]:
    """`compare` fields decide "same"; the rest (build strings) are reported but expected to
    differ between architectures."""
    names = sorted(set(official) | set(ours))
    same = [
        n
        for n in names
        if n in official and n in ours and official[n][:compare] == ours[n][:compare]
    ]
    return {
        "official_count": len(official),
        "modal_count": len(ours),
        "same_version": len(same),
        "version_differs": {
            n: {"official": official[n][0], "modal": ours[n][0]}
            for n in names
            if n in official and n in ours and official[n][:compare] != ours[n][:compare]
        },
        "only_in_official": {n: official[n][0] for n in names if n not in ours},
        "only_in_modal": {n: ours[n][0] for n in names if n not in official},
    }


def _arch_name(name: str) -> str:
    return name.replace("linux-aarch64", "linux-64").replace("aarch64", "x86-64")


def diff(official: dict[str, Any], ours: dict[str, Any]) -> dict[str, Any]:
    """A machine-readable comparison of the official arm64 image and the Modal amd64 image."""
    conda_a = {
        _arch_name(n): v for n, v in _versions(official["conda"], "version", "build").items()
    }
    conda_b = _versions(ours["conda"], "version", "build")
    apt_a = {_arch_name(n): v for n, v in _versions(official["apt"], "version").items()}
    apt_b = {_arch_name(n): v for n, v in _versions(ours["apt"], "version").items()}
    tools = {}
    for name in sorted(set(official["tools"]) | set(ours["tools"])):
        a = official["tools"].get(name, {}).get("output")
        b = ours["tools"].get(name, {}).get("output")
        tools[name] = {"official": a, "modal": b, "same": a == b}
    result: dict[str, Any] = {
        "official": {
            "image": OFFICIAL_IMAGE,
            "machine": official["platform"]["machine"],
            "os": official["os_release"].get("PRETTY_NAME"),
            "debian_version": official["debian_version"],
        },
        "modal": {
            "image": ours.get("modal_image", {}),
            "machine": ours["platform"]["machine"],
            "os": ours["os_release"].get("PRETTY_NAME"),
            "debian_version": ours["debian_version"],
        },
        "python": {"official": official["platform"]["python"], "modal": ours["platform"]["python"]},
        "r": {
            "official": official["r"].get("rversion"),
            "modal": ours["r"].get("rversion"),
            "blas_official": official["r"].get("blaslib"),
            "blas_modal": ours["r"].get("blaslib"),
        },
        "conda": _section(conda_a, conda_b, 1),
        "conda_build_string_differs": sum(
            1
            for n in conda_a
            if n in conda_b and conda_a[n][0] == conda_b[n][0] and conda_a[n] != conda_b[n]
        ),
        "conda_identical_files": sum(
            1 for n in conda_a if n in conda_b and conda_a[n] == conda_b[n]
        ),
        "pip": _section(
            _versions(official["pip"], "version"), _versions(ours["pip"], "version"), 1
        ),
        "r_packages": _section(
            _versions(official["r"]["packages"], "version"),
            _versions(ours["r"]["packages"], "version"),
            1,
        ),
        "apt": _section(apt_a, apt_b, 1),
        "tools": tools,
        "tools_differ": sorted(n for n, t in tools.items() if not t["same"]),
        "env": {
            k: {"official": official["env"].get(k), "modal": ours["env"].get(k)}
            for k in sorted(set(official["env"]) | set(ours["env"]))
        },
        # Every variable a command sees when the platform starts it directly. Modal adds
        # several; the sandbox provider starts every command without them (modal_boundary).
        "env_only_in_modal": {
            k: v for k, v in ours.get("env_all", {}).items() if k not in official.get("env_all", {})
        },
        "env_only_in_official": {
            k: v for k, v in official.get("env_all", {}).items() if k not in ours.get("env_all", {})
        },
        "env_removed_by_the_provider": sorted(set(MODAL_ADDED_ENV) & set(ours.get("env_all", {}))),
        "env_left_after_the_provider": sorted(
            set(ours.get("env_all", {})) - set(official.get("env_all", {})) - set(MODAL_ADDED_ENV)
        ),
        "python_sys_path": {
            "official": official.get("sys_path"),
            "modal_raw": ours.get("sys_path"),
        },
        "requirements_txt_same": official["requirements_txt"] == ours["requirements_txt"],
        "udocker_images": {"official": official["udocker_images"], "modal": ours["udocker_images"]},
        "udocker_layers_same": official["udocker_layers"] == ours["udocker_layers"],
        "kernelspecs": {
            "official": official["tools"].get("kernelspecs", {}).get("output"),
            "modal": ours["tools"].get("kernelspecs", {}).get("output"),
        },
    }
    return result


def diff_markdown(d: dict[str, Any]) -> str:
    def block(title: str, section: dict[str, Any]) -> list[str]:
        lines = [
            f"## {title}",
            "",
            f"- official: {section['official_count']}, Modal: {section['modal_count']}, "
            f"same name and version: {section['same_version']}",
        ]
        for key, label in (
            ("version_differs", "Version differs"),
            ("only_in_official", "Only in the official image"),
            ("only_in_modal", "Only in the Modal image"),
        ):
            rows = section[key]
            lines.append(f"- {label}: {len(rows)}")
            for name, value in rows.items():
                text = (
                    f"official {value['official']}, Modal {value['modal']}"
                    if isinstance(value, dict)
                    else value
                )
                lines.append(f"  - `{name}`: {text}")
        return [*lines, ""]

    out = [
        "# Official arm64 image vs the Modal amd64 image",
        "",
        "Made by `python -m bixbench_v1.modal_image diff` from the two inventories in this folder. ",
        "Do not edit by hand. The same content, machine-readable, is `diff.json`.",
        "",
        f"- Official: `{d['official']['image']}`, {d['official']['machine']}, {d['official']['os']} ({d['official']['debian_version']})",
        f"- Modal: `{d['modal']['image'].get('name')}` ({d['modal']['image'].get('id')}), {d['modal']['machine']}, {d['modal']['os']} ({d['modal']['debian_version']})",
        f"- Python: official {d['python']['official']}, Modal {d['python']['modal']}",
        f"- R: official {d['r']['official']}, Modal {d['r']['modal']}",
        f"- BLAS/LAPACK used by R: official `{d['r']['blas_official']}`, Modal `{d['r']['blas_modal']}`",
        f"- `/envs/requirements.txt` identical: {d['requirements_txt_same']}",
        f"- udocker images: official {d['udocker_images']['official']}, Modal {d['udocker_images']['modal']}; same layer files: {d['udocker_layers_same']}",
        "",
        "Every arch-specific conda package is necessarily a different binary: same version, "
        f"another build ({d['conda_build_string_differs']} packages). "
        f"{d['conda_identical_files']} conda packages are the identical file (noarch).",
        "",
        *block("Conda packages", d["conda"]),
        *block("Python packages as pip sees them", d["pip"]),
        *block("R packages (installed.packages)", d["r_packages"]),
        *block("Debian packages (dpkg)", d["apt"]),
        "## Tools",
        "",
        "| tool | official | Modal | same |",
        "|---|---|---|---|",
    ]
    for name, tool in d["tools"].items():
        cells = [
            str(tool[k] or "").replace("\n", " / ").replace("|", "\\|")[:110]
            for k in ("official", "modal")
        ]
        out.append(f"| {name} | {cells[0]} | {cells[1]} | {'yes' if tool['same'] else 'NO'} |")
    out += ["", "## Environment variables", ""]
    for key, value in d["env"].items():
        out.append(f"- `{key}`: official `{value['official']}`, Modal `{value['modal']}`")
    out += [
        "",
        "Modal adds these variables to a container. The sandbox provider starts every command "
        "without them (`env -u`), so the solver's commands do not see them:",
        "",
        *[f"- `{k}={v}`" for k, v in d["env_only_in_modal"].items()],
        "",
        f"Left after that: {d['env_left_after_the_provider'] or 'none'}. "
        f"Only in the official image: {d['env_only_in_official'] or 'none'}.",
    ]
    return "\n".join(out) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    commands = parser.add_subparsers(dest="command", required=True)
    sub = commands.add_parser("build", help="build and publish the image on Modal (billed)")
    sub.add_argument("--no-publish", action="store_true")
    sub = commands.add_parser("inventory", help="write image/amd64-modal.inventory.json (billed)")
    sub.add_argument("--image", default=PUBLISHED)
    commands.add_parser("diff", help="write image/diff.json and image/DIFF.md (free)")
    sub = commands.add_parser("equivalence", help="run the fixed analysis on Modal (billed)")
    sub.add_argument("--image", default=PUBLISHED)
    commands.add_parser("compare-equivalence", help="write image/equivalence.json and .md (free)")
    commands.add_parser(
        "fingerprint", help="write modal_env/expected-env.json from the inventory (free)"
    )
    sub = commands.add_parser(
        "verify", help="check a published image against expected-env.json (billed, small)"
    )
    sub.add_argument("--image", default=PUBLISHED)
    arguments = parser.parse_args()
    paid.enforce()
    try:
        if arguments.command == "build":
            print(f"built {PUBLISHED}: {build(publish=not arguments.no_publish)}")
            print("now check it: python -m bixbench_v1.modal_image verify")
        elif arguments.command == "fingerprint":
            written = write_fingerprint()
            print(f"wrote {modal_boundary.EXPECTED_ENV_FILE} for {written['image']}")
        elif arguments.command == "verify":
            problems = verify(arguments.image)
            print("the same environment as the repository" if not problems else "\n".join(problems))
            return 1 if problems else 0
        elif arguments.command == "inventory":
            document = inventory(arguments.image)
            target = EVIDENCE / "amd64-modal.inventory.json"
            target.write_text(json.dumps(document, indent=1, sort_keys=True) + "\n")
            print(f"wrote {target}")
        elif arguments.command == "equivalence":
            target = EVIDENCE / "equivalence.amd64-modal.json"
            target.write_text(json.dumps(equivalence(arguments.image), indent=1) + "\n")
            print(f"wrote {target}")
        elif arguments.command == "compare-equivalence":
            result = compare_equivalence(
                json.loads((EVIDENCE / "equivalence.arm64-official.json").read_text()),
                json.loads((EVIDENCE / "equivalence.amd64-modal.json").read_text()),
            )
            (EVIDENCE / "equivalence.json").write_text(json.dumps(result, indent=1) + "\n")
            (EVIDENCE / "EQUIVALENCE.md").write_text(equivalence_markdown(result))
            print(f"wrote {EVIDENCE / 'equivalence.json'} and {EVIDENCE / 'EQUIVALENCE.md'}")
        else:
            official = json.loads((EVIDENCE / "arm64-official.inventory.json").read_text())
            ours = json.loads((EVIDENCE / "amd64-modal.inventory.json").read_text())
            result = diff(official, ours)
            (EVIDENCE / "diff.json").write_text(json.dumps(result, indent=1, sort_keys=True) + "\n")
            (EVIDENCE / "DIFF.md").write_text(diff_markdown(result))
            print(f"wrote {EVIDENCE / 'diff.json'} and {EVIDENCE / 'DIFF.md'}")
    except paid.PaidCallsOff as error:
        sys.exit(f"bixbench-v1: {error}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
