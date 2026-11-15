#!/usr/bin/env python3
"""Deploy the hosted app from a frozen copy of the repository.

  python3 deploy/modal_host/deploy.py                 the working tree as it is now, DEMO mode
  python3 deploy/modal_host/deploy.py --from-head     the last commit (use it when someone is editing the tree)
  python3 deploy/modal_host/deploy.py --real          REAL mode: attaches the Secret asb-keys. Only the person who pays runs this.

Why a copy: other people and agents edit this tree, and Modal refuses a build when a file changes under it. The
files the image needs are copied to a temporary folder first, and that folder is what gets built. A note of what
was built (commit, whether the tree had changes, a hash of the copied files, the mode) goes into the image as
/app/BUILD.json and is printed when the container starts.

Never copied: .env files, node_modules, run folders, databases, tokens. Standard library only; needs `modal` and `git`.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
# The parts of the repository the hosted app is built from.
PARTS = ["engine/package.json", "engine/package-lock.json", "engine/src", "dashboard", "board/config.yaml", "board/agents", "board/context", "board/briefs", "board/expertise", "glhf/specialists", ".agents/skills"]
SKIP_DIRS = {"node_modules", "dist", "src-tauri", "target", ".venv", "__pycache__", "runs", ".git"}


def skip(folder: str, names: list[str]) -> list[str]:
    return [n for n in names if n in SKIP_DIRS or n == ".env" or n.startswith(".env.") or n.endswith((".sqlite", ".sqlite-wal", ".sqlite-shm")) or n in (".token", ".DS_Store")]


def stage(target: Path, from_head: bool) -> None:
    if from_head:
        archive = subprocess.run(["git", "-C", str(REPO), "archive", "HEAD", *PARTS], check=True, capture_output=True).stdout
        subprocess.run(["tar", "-x", "-C", str(target)], input=archive, check=True)
        for folder, dirs, _files in os.walk(target):  # the same rules for a commit as for the tree
            for name in skip(folder, dirs):
                shutil.rmtree(Path(folder) / name)
        return
    for part in PARTS:
        source, out = REPO / part, target / part
        out.parent.mkdir(parents=True, exist_ok=True)
        if source.is_dir():
            shutil.copytree(source, out, ignore=skip, symlinks=False)
        else:
            shutil.copyfile(source, out)


def tree_hash(root: Path) -> tuple[str, int]:
    digest, count = hashlib.sha256(), 0
    for file in sorted(p for p in root.rglob("*") if p.is_file()):
        digest.update(str(file.relative_to(root)).encode() + b"\0" + hashlib.sha256(file.read_bytes()).digest())
        count += 1
    return digest.hexdigest()[:16], count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--from-head", action="store_true", help="build the last commit, not the working tree")
    parser.add_argument("--real", action="store_true", help="attach the key Secret (asb-keys). The engine still starts in Demo.")
    parser.add_argument("--label", default=os.environ.get("ASB_HOST_LABEL", "asb"), help="the address is https://<workspace>--<label>.modal.run")
    args = parser.parse_args()
    git = lambda *a: subprocess.run(["git", "-C", str(REPO), *a], capture_output=True, text=True).stdout.strip()  # noqa: E731
    with tempfile.TemporaryDirectory(prefix="asb-host-src-") as folder:
        source = Path(folder)
        stage(source, args.from_head)
        leaked = [str(p.relative_to(source)) for p in source.rglob("*") if p.name == ".env" or p.name.startswith(".env.")]
        if leaked:
            sys.exit(f"refusing to deploy: {leaked} would be in the image")
        digest, count = tree_hash(source)
        dirty = [] if args.from_head else [line for line in git("status", "--short", "--", *PARTS).splitlines() if line]
        build = {"commit": git("rev-parse", "--short", "HEAD"), "source": "commit" if args.from_head else "working tree", "changedFiles": len(dirty),
                 "files": count, "treeHash": digest, "mode": "real" if args.real else "demo", "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        (source / "BUILD.json").write_text(json.dumps(build, indent=1))
        print(f"building {build['source']} at {build['commit']}" + (f" with {len(dirty)} changed files" if dirty else "") + f": {count} files, hash {digest}, mode {build['mode']}")
        env = {**os.environ, "ASB_HOST_SOURCE": str(source), "ASB_HOST_MODE": build["mode"], "ASB_HOST_LABEL": args.label}
        sys.exit(subprocess.run(["modal", "deploy", str(HERE / "app.py")], env=env).returncode)


if __name__ == "__main__":
    main()
