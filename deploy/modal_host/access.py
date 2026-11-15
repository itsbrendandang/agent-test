#!/usr/bin/env python3
"""Who may open the hosted app. Makes personal access codes and puts their hashes in the Modal Secret `asb-host-access`.

  python3 deploy/modal_host/access.py add owner ada grace   a new code for each name (a name that exists gets a new code)
  python3 deploy/modal_host/access.py remove grace          take a person out
  python3 deploy/modal_host/access.py list                  names and dates (never a code)
  python3 deploy/modal_host/access.py sign-out-everyone     a new cookie key: every session ends, the codes stay
  python3 deploy/modal_host/access.py push                  send the current list to Modal again

A code is 32 random characters (190 bits). It is written to deploy/modal_host/.local/codes/<name>.txt (mode 600,
ignored by git) and never printed: open that file and send the code to the person in private. Modal gets only
the SHA-256 of each code and the key that signs session cookies. Nothing here is an API key.

After any change, the running container still has the old list. Apply it with:
  python3 deploy/modal_host/deploy.py

Standard library only; needs the `modal` command on the PATH, logged in.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import time
from pathlib import Path

LOCAL = Path(__file__).resolve().parent / ".local"
STATE = LOCAL / "access.json"
CODES = LOCAL / "codes"
SECRET = "asb-host-access"
NAME = re.compile(r"^[a-z0-9_-]{1,32}$")


def load() -> dict:
    if STATE.exists():
        return json.loads(STATE.read_text())
    return {"cookie_key": secrets.token_hex(32), "users": {}}


def write_private(file: Path, text: str) -> None:
    file.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(file.parent, 0o700)
    fd = os.open(file.with_suffix(file.suffix + ".part"), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write(text)
    os.replace(file.with_suffix(file.suffix + ".part"), file)


def save(state: dict) -> None:
    LOCAL.mkdir(exist_ok=True)
    os.chmod(LOCAL, 0o700)
    write_private(STATE, json.dumps(state, indent=1, sort_keys=True))


def secret_values(state: dict) -> dict[str, str]:
    """What Modal holds: hashes and the cookie key. No code."""
    return {"ASB_ACCESS_HASHES": json.dumps({name: user["hash"] for name, user in sorted(state["users"].items())}), "ASB_COOKIE_KEY": state["cookie_key"]}


def push(state: dict) -> None:
    if not state["users"]:
        sys.exit("nobody is on the list: add at least one name first (a deployment with an empty list serves nothing)")
    with tempfile.TemporaryDirectory() as folder:
        file = Path(folder) / "secret.json"
        write_private(file, json.dumps(secret_values(state)))  # a file, so the values are never on a command line
        done = subprocess.run(["modal", "secret", "create", SECRET, "--from-json", str(file), "--force"], capture_output=True, text=True)
    if done.returncode != 0:
        sys.exit(f"modal secret create failed:\n{done.stderr.strip()[-800:]}")
    print(f"Modal Secret {SECRET} now lists: {', '.join(sorted(state['users']))}.")
    print("Apply it to the running app:  python3 deploy/modal_host/deploy.py")


def main(argv: list[str]) -> None:
    if not argv or argv[0] in ("-h", "--help"):
        sys.exit(__doc__)
    command, names = argv[0], argv[1:]
    state = load()
    if command == "list":
        for name, user in sorted(state["users"].items()):
            print(f"{name}\tcode made {time.strftime('%Y-%m-%d %H:%M', time.localtime(user['created']))}")
        if not state["users"]:
            print("nobody yet")
        return
    if command in ("add", "remove"):
        bad = [name for name in names if not NAME.match(name)]
        if not names or bad:
            sys.exit(f"give names made of a-z, 0-9, _ and - (at most 32 characters){': not ' + ', '.join(bad) if bad else ''}")
    if command == "add":
        for name in names:
            code = secrets.token_urlsafe(24)  # 32 characters
            state["users"][name] = {"hash": hashlib.sha256(code.encode()).hexdigest(), "created": int(time.time())}
            write_private(CODES / f"{name}.txt", code + "\n")
            print(f"{name}: the code is in {CODES / (name + '.txt')} (send it in private; it is shown nowhere else)")
    elif command == "remove":
        for name in names:
            if state["users"].pop(name, None) is None:
                print(f"{name} was not on the list")
            (CODES / f"{name}.txt").unlink(missing_ok=True)
    elif command == "sign-out-everyone":
        state["cookie_key"] = secrets.token_hex(32)
    elif command != "push":
        sys.exit(__doc__)
    save(state)
    push(state)


if __name__ == "__main__":
    main(sys.argv[1:])
