"""Print one JSON document describing what is installed in this image. Runs in the official
arm64 image (local Docker) and in the amd64 Modal image; the two outputs are diffed.
No network is needed. Usage: python inventory.py > inventory.json"""

import json, os, platform, subprocess, sys


def sh(cmd, timeout=600):
    try:
        r = subprocess.run(["bash", "-c", cmd], capture_output=True, text=True, timeout=timeout)
        return (r.stdout + r.stderr).strip(), r.returncode
    except Exception as e:  # noqa: BLE001
        return f"ERROR {type(e).__name__}: {e}", -1


def first(cmd, timeout=120):
    out, code = sh(cmd, timeout)
    return {"output": out[:400], "exit": code}


doc = {"platform": {"machine": platform.machine(), "python": sys.version.split()[0]}}
doc["os_release"] = dict(
    line.strip().split("=", 1) for line in open("/etc/os-release") if "=" in line
)
doc["debian_version"] = open("/etc/debian_version").read().strip()
doc["env"] = {k: os.environ.get(k) for k in ("PATH", "LANG", "LC_ALL", "DEBIAN_FRONTEND")}
# Every variable a command sees, as started by the platform (docker run / Modal exec), without
# the ones that name the container itself.
doc["env_all"] = {
    k: v
    for k, v in sorted(os.environ.items())
    if k
    not in (
        "HOSTNAME",
        "PWD",
        "OLDPWD",
        "SHLVL",
        "_",
        "MODAL_SANDBOX_ID",
        "MODAL_TASK_ID",
        "MODAL_REGION",
        "MODAL_CLOUD_PROVIDER",
    )
}
doc["sys_path"] = sys.path[1:]
doc["cpu"] = {"count": os.cpu_count()}

out, _ = sh("conda list --json")
try:
    doc["conda"] = sorted(
        (
            {
                "name": p["name"],
                "version": p["version"],
                "build": p.get("build_string"),
                "channel": p.get("channel"),
                "platform": p.get("platform"),
            }
            for p in json.loads(out)
        ),
        key=lambda p: p["name"],
    )
except Exception as e:  # noqa: BLE001
    doc["conda"] = f"ERROR {e}: {out[:300]}"
out, _ = sh("conda list --explicit")
doc["conda_explicit"] = [l for l in out.splitlines() if l.startswith("http")]
out, _ = sh("python -m pip list --format json 2>/dev/null")
try:
    doc["pip"] = sorted(json.loads(out), key=lambda p: p["name"].lower())
except Exception as e:  # noqa: BLE001
    doc["pip"] = f"ERROR {e}: {out[:300]}"
out, _ = sh("python -m pip freeze 2>/dev/null")
doc["pip_freeze"] = out.splitlines()

r_code = r"""
ip <- installed.packages()[, c("Package","Version","Priority","Built","LibPath"), drop=FALSE]
ip <- ip[order(ip[, "Package"]), , drop=FALSE]
cat("RVERSION\t", R.version.string, "\n", sep="")
bioc <- tryCatch(as.character(BiocManager::version()), error=function(e) NA)
cat("BIOC\t", bioc, "\n", sep="")
cat("BLAS\t", extSoftVersion()[["BLAS"]], "\n", sep="")
si <- sessionInfo(); cat("LAPACK\t", si$LAPACK, "\n", sep=""); cat("BLASLIB\t", si$BLAS, "\n", sep="")
for (i in seq_len(nrow(ip))) cat("PKG\t", paste(ip[i, ], collapse="\t"), "\n", sep="")
"""
out, code = sh("Rscript -e " + json.dumps(r_code).replace("$", "\\$"), 600)
r = {"packages": [], "exit": code}
for line in out.splitlines():
    parts = line.split("\t")
    if parts[0] == "PKG" and len(parts) >= 5:
        r["packages"].append(
            {"name": parts[1], "version": parts[2], "priority": parts[3], "built": parts[4]}
        )
    elif parts[0] in ("RVERSION", "BIOC", "BLAS", "LAPACK", "BLASLIB"):
        r[parts[0].lower()] = parts[1] if len(parts) > 1 else None
if not r["packages"]:
    r["raw"] = out[:2000]
doc["r"] = r

out, _ = sh(r"dpkg-query -W -f '${Package}\t${Version}\t${Architecture}\t${db:Status-Abbrev}\n'")
doc["apt"] = [
    dict(zip(("name", "version", "arch", "status"), l.split("\t")))
    for l in out.splitlines()
    if l.strip()
]

doc["tools"] = {
    name: first(cmd)
    for name, cmd in {
        "python": "python --version",
        "which_python": "which python python3",
        "R": "R --version | head -1",
        "conda": "conda --version",
        "mamba": "mamba --version",
        "pip": "python -m pip --version",
        "blastn": "blastn -version | head -1",
        "mafft": "mafft --version",
        "iqtree2": "iqtree2 --version | head -1",
        "iqtree": "iqtree --version | head -1",
        "clipkit": "clipkit --version",
        "phykit": "phykit --version",
        "fastqc": "fastqc --version",
        "spades": "spades.py --version",
        "trim_galore": "trim_galore --version | grep -i version",
        "cutadapt": "cutadapt --version",
        "metaeuk": "metaeuk version",
        "perl": "perl -e 'print $^V'",
        "udocker": "udocker --allow-root --version | head -3",
        "sqlite3": "sqlite3 --version",
        "gcc": "gcc --version | head -1",
        "git": "git --version",
        "java": "java -version 2>&1 | head -1",
        "samtools": "samtools --version | head -1",
        "bwa": "bwa 2>&1 | grep -i version",
        "jupyter": "jupyter --version | head -12",
        "kernelspecs": "jupyter kernelspec list",
        "wget": "wget --version | head -1",
        "curl": "curl --version | head -1",
        "ipcs": "command -v ipcs ipcrm ipcmk",
        "su": "command -v su useradd pkill",
        "glibc": "ldd --version | head -1",
        "openssl": "openssl version",
        "hmmsearch": "hmmsearch -h | sed -n 2p",
        "busco_host": "command -v busco",
    }.items()
}
out, _ = sh("udocker --allow-root images 2>&1")
doc["udocker_images"] = out.splitlines()
out, _ = sh("ls /root/.udocker 2>/dev/null; du -sm /root/.udocker 2>/dev/null")
doc["udocker_dir"] = out.splitlines()
out, _ = sh("find /root/.udocker/layers -type f -o -type l 2>/dev/null | sed 's|.*/||' | sort")
doc["udocker_layers"] = out.splitlines()
out, _ = sh("cat /envs/requirements.txt 2>/dev/null")
doc["requirements_txt"] = out.splitlines()
out, _ = sh(
    "python - <<'P'\nimport numpy, io, contextlib\nb=io.StringIO()\nwith contextlib.redirect_stdout(b): numpy.show_config()\nprint(b.getvalue())\nP"
)
doc["numpy_config"] = out[:3000]
out, _ = sh(
    "ls -la /opt/conda/lib/libblas.so* /opt/conda/lib/liblapack.so* /opt/conda/lib/libopenblas*.so* 2>/dev/null"
)
doc["blas_files"] = out.splitlines()
out, _ = sh("du -sm /opt/conda /root/.udocker /usr 2>/dev/null")
doc["sizes_mb"] = out.splitlines()
out, _ = sh("ls / /workspace /envs /home 2>&1")
doc["layout"] = out.splitlines()
out, _ = sh("cat /root/.bashrc | tail -5; ls -la /etc/profile.d/")
doc["shell_setup"] = out.splitlines()
json.dump(doc, sys.stdout, indent=1, sort_keys=True)
