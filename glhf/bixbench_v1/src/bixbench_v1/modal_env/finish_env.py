"""Build step of the Modal sandbox image, run once inside the image after the explicit install.

The explicit list holds every package of the official arm64 image, mapped to linux-64. The
base image (miniconda) brings a few packages of its own; any that the official image does not
have are removed here, and the result is checked against the list: a package of the list that
is missing or has another version or build fails the build."""

import json
import re
import subprocess
import sys

wanted: dict[str, str] = {}
for line in open(sys.argv[1], encoding="utf-8"):
    line = line.strip()
    if not line.startswith("http"):
        continue
    stem = re.sub(r"\.(conda|tar\.bz2)$", "", line.split("#")[0].rsplit("/", 1)[1])
    name, version, build = stem.rsplit("-", 2)
    wanted[name] = f"{version}={build}"


def installed() -> dict[str, str]:
    out = subprocess.run(
        ["conda", "list", "-n", "base", "--json"], capture_output=True, text=True, check=True
    ).stdout
    return {p["name"]: f"{p['version']}={p['build_string']}" for p in json.loads(out)}


extras = sorted(set(installed()) - set(wanted))
if extras:
    print("removing packages the official image does not have:", extras, flush=True)
    subprocess.run(["conda", "remove", "-n", "base", "--force", "-y", *extras], check=True)
now = installed()
wrong = {n: (v, now.get(n)) for n, v in wanted.items() if now.get(n) != v}
extra = sorted(set(now) - set(wanted))
if wrong or extra:
    print("MISMATCH", json.dumps({"wrong": wrong, "extra": extra}, indent=1))
    sys.exit(1)
print(f"environment matches the list: {len(now)} packages")
